import express from 'express'
import multer from 'multer'
import { supabaseAdmin } from '../lib/supabase.js'
import { requireAuth, checkAccess } from '../middleware/auth.js'
import { processStatement } from '../jobs/processStatement.js'
import { processCaseDocument } from '../jobs/processCaseDocument.js'
import { processExpertFinding } from '../jobs/processExpertFinding.js'
import { checkOcrQuota, incrementOcrCount } from '../lib/quotaService.js'
import { sendVerificationNotification } from '../lib/emailService.js'
import { randomUUID } from 'crypto'

const router = express.Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/jpeg',
      'image/png',
      'text/plain',
    ]
    allowed.includes(file.mimetype)
      ? cb(null, true)
      : cb(new Error('Unsupported file type'))
  },
})

async function getUserContext(authUserId) {
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('id, org_id, full_name')
    .eq('auth_user_id', authUserId)
    .single()
  return data
}


// POST /api/uploads/verification
router.post('/verification', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' })

  const { doc_type } = req.body
  const validTypes = ['approbation', 'facharzturkunde', 'berufsausweis', 'other']
  if (!validTypes.includes(doc_type)) {
    return res.status(400).json({ error: 'Invalid doc_type' })
  }

  const profile = await getUserContext(req.user.id)
  if (!profile?.org_id) {
    return res.status(400).json({ error: 'User has no organisation' })
  }

  const ext = req.file.originalname.split('.').pop()
  const storagePath = `${profile.org_id}/${profile.id}/${randomUUID()}.${ext}`

  const { error: storageError } = await supabaseAdmin.storage
    .from('verification-documents')
    .upload(storagePath, req.file.buffer, { contentType: req.file.mimetype })

  if (storageError) throw storageError

  const { data: doc, error: dbError } = await supabaseAdmin
    .from('verification_documents')
    .insert({
      user_id: profile.id,
      org_id: profile.org_id,
      doc_type,
      storage_path: storagePath,
      status: 'pending',
    })
    .select()
    .single()

  if (dbError) throw dbError

  await supabaseAdmin
    .from('profiles')
    .update({ verification_status: 'pending' })
    .eq('id', profile.id)

  // Respond immediately
  res.status(201).json({ document: doc })

  // Send notification email to admin — fire and forget
  try {
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('name')
      .eq('id', profile.org_id)
      .single()

    await sendVerificationNotification({
      fullName: profile.full_name || req.user.email,
      docType: doc_type,
      orgName: org?.name,
      submittedAt: doc.submitted_at || new Date().toISOString(),
      userId: req.user.id,
      orgId: profile.org_id,
    })
    console.log(`[EMAIL] Verification notification sent for ${profile.full_name}`)
  } catch (emailErr) {
    console.error('[EMAIL] Failed to send verification notification:', emailErr.message)
  }
})


// GET /api/uploads/statements
router.get('/statements', requireAuth, async (req, res) => {
  const profile = await getUserContext(req.user.id)
  if (!profile?.org_id) return res.json({ statements: [] })

  const { data: statements, error } = await supabaseAdmin
    .from('past_statements')
    .select('id, file_name, status, error_message, created_at')
    .eq('user_id', profile.id)
    .order('created_at', { ascending: false })

  if (error) throw error
  res.json({ statements })
})


// POST /api/uploads/statement
router.post('/statement', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' })

  const profile = await getUserContext(req.user.id)
  if (!profile?.org_id) {
    return res.status(400).json({ error: 'User has no organisation' })
  }

  const ext = req.file.originalname.split('.').pop()
  const storagePath = `${profile.org_id}/${profile.id}/${randomUUID()}.${ext}`

  const { error: storageError } = await supabaseAdmin.storage
    .from('past-statements')
    .upload(storagePath, req.file.buffer, { contentType: req.file.mimetype })

  if (storageError) throw storageError

  const { data: statement, error: dbError } = await supabaseAdmin
    .from('past_statements')
    .insert({
      org_id: profile.org_id,
      user_id: profile.id,
      file_name: req.file.originalname,
      storage_path: storagePath,
      status: 'pending',
    })
    .select()
    .single()

  if (dbError) throw dbError

  res.status(201).json({ statement })

  processStatement(statement.id).catch(err =>
    console.error('[RAG] Unhandled error in processStatement:', err)
  )
})


// DELETE /api/uploads/statement/:id
router.delete('/statement/:id', requireAuth, async (req, res) => {
  const profile = await getUserContext(req.user.id)
  if (!profile) return res.status(404).json({ error: 'Profile not found' })

  const { data: statement } = await supabaseAdmin
    .from('past_statements')
    .select('id, storage_path')
    .eq('id', req.params.id)
    .eq('user_id', profile.id)
    .single()

  if (!statement) return res.status(404).json({ error: 'Statement not found' })

  await supabaseAdmin.storage
    .from('past-statements')
    .remove([statement.storage_path])

  await supabaseAdmin
    .from('past_statements')
    .delete()
    .eq('id', statement.id)

  res.json({ message: 'Statement deleted' })
})


// POST /api/uploads/case-document
router.post('/case-document', requireAuth, checkAccess, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' })

  const { case_id, doc_type = 'other' } = req.body
  if (!case_id) return res.status(400).json({ error: 'case_id is required' })

  const profile = await getUserContext(req.user.id)
  if (!profile?.org_id) {
    return res.status(400).json({ error: 'User has no organisation' })
  }

  const { data: caseRow } = await supabaseAdmin
    .from('cases')
    .select('id, org_id')
    .eq('id', case_id)
    .eq('org_id', profile.org_id)
    .single()

  if (!caseRow) return res.status(404).json({ error: 'Case not found' })

  const ext = req.file.originalname.split('.').pop()
  const storagePath = `${profile.org_id}/${case_id}/${randomUUID()}.${ext}`

  const { error: storageError } = await supabaseAdmin.storage
    .from('case-documents')
    .upload(storagePath, req.file.buffer, { contentType: req.file.mimetype })

  if (storageError) throw storageError

  const { data: doc, error: dbError } = await supabaseAdmin
    .from('case_documents')
    .insert({
      case_id,
      org_id: profile.org_id,
      uploaded_by: profile.id,
      file_name: req.file.originalname,
      storage_path: storagePath,
      doc_type,
      status: 'pending',
    })
    .select()
    .single()

  if (dbError) throw dbError

  // Check OCR quota before processing
  const ocrQuota = await checkOcrQuota(profile.org_id, case_id, 'case_document')
  if (!ocrQuota.allowed) {
    // File is stored but will not be OCR-processed — mark as quota_exceeded
    await supabaseAdmin
      .from('case_documents')
      .update({ status: 'error', error_message: `OCR-Limit erreicht (${ocrQuota.used}/${ocrQuota.limit} für diesen Fall)` })
      .eq('id', doc.id)
    return res.status(201).json({ document: { ...doc, status: 'error', error_message: `OCR-Limit erreicht (${ocrQuota.used}/${ocrQuota.limit} für diesen Fall)` }, ocr_quota_exceeded: true })
  }

  await incrementOcrCount(case_id, 'case_document')

  res.status(201).json({ document: doc })

  processCaseDocument(doc.id).catch(err =>
    console.error('[OCR] Unhandled error in processCaseDocument:', err)
  )
})


// GET /api/uploads/statement/:id/status
router.get('/statement/:id/status', requireAuth, async (req, res) => {
  const profile = await getUserContext(req.user.id)

  const { data } = await supabaseAdmin
    .from('past_statements')
    .select('id, status, error_message')
    .eq('id', req.params.id)
    .eq('org_id', profile?.org_id)
    .single()

  if (!data) return res.status(404).json({ error: 'Statement not found' })
  res.json(data)
})


// GET /api/uploads/case-document/:id/status
router.get('/case-document/:id/status', requireAuth, async (req, res) => {
  const profile = await getUserContext(req.user.id)

  const { data } = await supabaseAdmin
    .from('case_documents')
    .select('id, status, error_message, extracted_text')
    .eq('id', req.params.id)
    .eq('org_id', profile?.org_id)
    .single()

  if (!data) return res.status(404).json({ error: 'Document not found' })
  res.json(data)
})


// PATCH /api/uploads/case-document/:id/ignore
// Toggle ignored status on a case document
// Body: { ignored: boolean }
router.patch('/case-document/:id/ignore', requireAuth, async (req, res) => {
  const { ignored } = req.body
  if (typeof ignored !== 'boolean') return res.status(400).json({ error: 'ignored must be boolean' })

  const profile = await getUserContext(req.user.id)
  if (!profile?.org_id) return res.status(404).json({ error: 'Not found' })

  const { data: doc, error } = await supabaseAdmin
    .from('case_documents')
    .update({ ignored })
    .eq('id', req.params.id)
    .eq('org_id', profile.org_id)
    .select('id, ignored')
    .single()

  if (error || !doc) return res.status(404).json({ error: 'Document not found' })
  res.json({ document: doc })
})


// DELETE /api/uploads/case-document/:id
// Delete a case document from storage and DB
router.delete('/case-document/:id', requireAuth, async (req, res) => {
  const profile = await getUserContext(req.user.id)
  if (!profile?.org_id) return res.status(404).json({ error: 'Not found' })

  const { data: doc } = await supabaseAdmin
    .from('case_documents')
    .select('id, storage_path')
    .eq('id', req.params.id)
    .eq('org_id', profile.org_id)
    .single()

  if (!doc) return res.status(404).json({ error: 'Document not found' })

  // Delete from storage
  if (doc.storage_path) {
    await supabaseAdmin.storage
      .from('case-documents')
      .remove([doc.storage_path])
  }

  // Delete from DB
  await supabaseAdmin
    .from('case_documents')
    .delete()
    .eq('id', doc.id)

  res.json({ message: 'Document deleted' })
})


// POST /api/uploads/own-finding
// Upload or save an expert finding into the expert_findings table
// Body (multipart or JSON): case_id, doc_type, text? (for text input), file? (for upload)
router.post('/own-finding', requireAuth, upload.single('file'), async (req, res) => {
  const { case_id, doc_type, text } = req.body

  if (!case_id) return res.status(400).json({ error: 'case_id required' })

  const validTypes = ['exploration', 'untersuchung', 'amdp', 'anamnese', 'sonstig']
  if (!validTypes.includes(doc_type)) {
    return res.status(400).json({ error: `Invalid doc_type. Must be one of: ${validTypes.join(', ')}` })
  }

  const profile = await getUserContext(req.user.id)
  if (!profile?.org_id) return res.status(400).json({ error: 'User has no organisation' })

  // Verify case belongs to org
  const { data: caseRow } = await supabaseAdmin
    .from('cases')
    .select('id')
    .eq('id', case_id)
    .eq('org_id', profile.org_id)
    .single()

  if (!caseRow) return res.status(404).json({ error: 'Case not found' })

  const typeLabels = {
    exploration:  'Exploration',
    untersuchung: 'Untersuchung',
    amdp:         'AMDP-Befund',
    anamnese:     'Fremd-/Anamnese',
    sonstig:      'Sonstiger Befund',
  }

  if (req.file) {
    // File upload path — store in expert-findings bucket
    const ext         = req.file.originalname.split('.').pop()
    const storagePath = `${profile.org_id}/${case_id}/${randomUUID()}.${ext}`

    const { error: storageError } = await supabaseAdmin.storage
      .from('expert-findings')
      .upload(storagePath, req.file.buffer, { contentType: req.file.mimetype })

    if (storageError) throw storageError

    const { data: finding, error: dbError } = await supabaseAdmin
      .from('expert_findings')
      .insert({
        case_id,
        org_id:       profile.org_id,
        uploaded_by:  profile.id,
        file_name:    `${typeLabels[doc_type]}: ${req.file.originalname}`,
        storage_path: storagePath,
        doc_type,
        status:       'pending',
      })
      .select()
      .single()

    if (dbError) throw dbError

    // Check OCR quota before processing
    const ocrQuota = await checkOcrQuota(profile.org_id, case_id, 'expert_finding')
    if (!ocrQuota.allowed) {
      await supabaseAdmin
        .from('expert_findings')
        .update({ status: 'error', error_message: `OCR-Limit erreicht (${ocrQuota.used}/${ocrQuota.limit} für diesen Fall)` })
        .eq('id', finding.id)
      return res.status(201).json({ finding: { ...finding, status: 'error', error_message: `OCR-Limit erreicht (${ocrQuota.used}/${ocrQuota.limit} für diesen Fall)` }, ocr_quota_exceeded: true })
    }

    await incrementOcrCount(case_id, 'expert_finding')

    res.status(201).json({ finding })

    // Process with dedicated expert finding processor
    processExpertFinding(finding.id).catch(err =>
      console.error('[OCR] Unhandled error in processExpertFinding:', err)
    )

  } else if (text?.trim()) {
    // Text input path — store directly as extracted_text, no OCR needed
    const { data: finding, error: dbError } = await supabaseAdmin
      .from('expert_findings')
      .insert({
        case_id,
        org_id:         profile.org_id,
        uploaded_by:    profile.id,
        file_name:      `${typeLabels[doc_type]} (Texteingabe)`,
        storage_path:   null,
        doc_type,
        status:         'ready',
        extracted_text: text.trim(),
      })
      .select()
      .single()

    if (dbError) throw dbError
    res.status(201).json({ finding })

  } else {
    res.status(400).json({ error: 'Either file or text is required' })
  }
})


export default router


// POST /api/uploads/court-order
// Upload the Gerichtsbeschluss for a case
// Body (multipart): file, case_id
import { processCourtOrder } from '../jobs/processCourtOrder.js'

router.post('/court-order', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' })

  const { case_id } = req.body
  if (!case_id) return res.status(400).json({ error: 'case_id is required' })

  const profile = await getUserContext(req.user.id)
  if (!profile?.org_id) return res.status(400).json({ error: 'User has no organisation' })

  const { data: caseRow } = await supabaseAdmin
    .from('cases')
    .select('id, org_id')
    .eq('id', case_id)
    .eq('org_id', profile.org_id)
    .single()

  if (!caseRow) return res.status(404).json({ error: 'Case not found' })

  const ext = req.file.originalname.split('.').pop()
  const storagePath = `${profile.org_id}/${case_id}/gerichtsbeschluss_${randomUUID()}.${ext}`

  const { error: storageError } = await supabaseAdmin.storage
    .from('case-documents')
    .upload(storagePath, req.file.buffer, { contentType: req.file.mimetype })

  if (storageError) throw storageError

  await supabaseAdmin
    .from('cases')
    .update({
      gerichtsbeschluss_storage_path: storagePath,
      gerichtsbeschluss_status: 'pending',
      beweisfragen: [],
      beweisfragen_raw_text: null,
    })
    .eq('id', case_id)

  res.status(201).json({ message: 'Court order uploaded, extraction starting' })

  // Fire and forget
  processCourtOrder(case_id).catch(err =>
    console.error('[COURT] Unhandled error:', err)
  )
})