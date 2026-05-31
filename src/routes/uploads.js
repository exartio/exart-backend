import express from 'express'
import multer from 'multer'
import { supabaseAdmin } from '../lib/supabase.js'
import { requireAuth, checkAccess } from '../middleware/auth.js'
import { processStatement } from '../jobs/processStatement.js'
import { processCaseDocument } from '../jobs/processCaseDocument.js'
import { randomUUID } from 'crypto'

const router = express.Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
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
    .select('id, org_id')
    .eq('auth_user_id', authUserId)
    .single()
  return data
}


// POST /api/uploads/verification
// Upload a physician credential document
// Body (multipart): file, doc_type
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

  res.status(201).json({ document: doc })
})


// POST /api/uploads/statement
// Upload a past Gutachten for RAG ingestion
// Body (multipart): file
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

  // Respond immediately — processing runs in background
  res.status(201).json({ statement })

  // Fire and forget — errors are caught inside and written to DB
  processStatement(statement.id).catch(err =>
    console.error('[RAG] Unhandled error in processStatement:', err)
  )
})


// POST /api/uploads/case-document
// Upload a document for a specific case
// Body (multipart): file, case_id, doc_type
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

  // Respond immediately — OCR runs in background
  res.status(201).json({ document: doc })

  // Fire and forget
  processCaseDocument(doc.id).catch(err =>
    console.error('[OCR] Unhandled error in processCaseDocument:', err)
  )
})


// GET /api/uploads/statement/:id/status
// Poll processing status of a past statement
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
// Poll processing status of a case document
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

export default router
