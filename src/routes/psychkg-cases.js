import express from 'express'
import { supabaseAdmin } from '../lib/supabase.js'
import { requireAuth } from '../middleware/auth.js'

const router = express.Router()

async function getOrgId(authUserId) {
  const { data } = await supabaseAdmin
    .from('organization_members')
    .select('org_id')
    .eq('user_id', authUserId)
    .single()
  return data?.org_id || null
}

// GET /api/psychkg-cases
router.get('/', requireAuth, async (req, res) => {
  const org_id = await getOrgId(req.user.id)
  if (!org_id) return res.json({ cases: [] })

  const { data: cases, error } = await supabaseAdmin
    .from('psychkg_cases')
    .select(`
      id, title, patient_ref, betroffener_name, betroffener_dob,
      bundesland, aufnahme_datum, beschluss_datum, beschluss_bis,
      gericht, aktenzeichen, status, created_at, updated_at,
      psychkg_documents ( id, doc_type, title, status, created_at )
    `)
    .eq('org_id', org_id)
    .order('updated_at', { ascending: false })

  if (error) throw error
  res.json({ cases })
})

// GET /api/psychkg-cases/:id
router.get('/:id', requireAuth, async (req, res) => {
  const org_id = await getOrgId(req.user.id)
  if (!org_id) return res.status(404).json({ error: 'Not found' })

  const { data: caseRow, error } = await supabaseAdmin
    .from('psychkg_cases')
    .select(`
      *,
      psychkg_documents ( * )
    `)
    .eq('id', req.params.id)
    .eq('org_id', org_id)
    .single()

  if (error || !caseRow) return res.status(404).json({ error: 'Case not found' })
  res.json({ case: caseRow })
})

// POST /api/psychkg-cases
// Body: { title, patient_ref, betroffener_name?, betroffener_dob? }
router.post('/', requireAuth, async (req, res) => {
  const { title, patient_ref, betroffener_name, betroffener_dob } = req.body

  if (!title) return res.status(400).json({ error: 'title is required' })

  const org_id = await getOrgId(req.user.id)
  if (!org_id) return res.status(400).json({ error: 'User has no organisation' })

  // Verify suite access
  const { data: suiteAccess } = await supabaseAdmin
    .from('org_suite_access')
    .select('enabled')
    .eq('org_id', org_id)
    .eq('suite', 'psychkg')
    .single()

  if (!suiteAccess?.enabled) {
    return res.status(403).json({ error: 'psychkg_suite_not_licensed' })
  }

  // Pull bundesland from org
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('bundesland')
    .eq('id', org_id)
    .single()

  const { data: caseRow, error } = await supabaseAdmin
    .from('psychkg_cases')
    .insert({
      org_id,
      created_by:       req.user.id,
      title,
      patient_ref:      patient_ref || null,
      bundesland:       org?.bundesland || null,
      betroffener_name: betroffener_name || null,
      betroffener_dob:  betroffener_dob || null,
      status:           'draft',
    })
    .select()
    .single()

  if (error) throw error

  await supabaseAdmin.from('audit_log').insert({
    org_id,
    user_id:     req.user.id,
    action:      'psychkg_case.created',
    entity_type: 'psychkg_cases',
    entity_id:   caseRow.id,
  })

  res.status(201).json({ case: caseRow })
})

// PATCH /api/psychkg-cases/:id
// Body: any subset of allowed fields
router.patch('/:id', requireAuth, async (req, res) => {
  const org_id = await getOrgId(req.user.id)
  if (!org_id) return res.status(404).json({ error: 'Not found' })

  const allowed = [
    'title', 'patient_ref', 'betroffener_name', 'betroffener_dob',
    'aufnahme_datum', 'beschluss_datum', 'beschluss_bis',
    'gericht', 'aktenzeichen', 'status', 'assigned_to',
  ]
  const updates = Object.fromEntries(
    Object.entries(req.body).filter(([k]) => allowed.includes(k))
  )

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' })
  }

  const { data: caseRow, error } = await supabaseAdmin
    .from('psychkg_cases')
    .update(updates)
    .eq('id', req.params.id)
    .eq('org_id', org_id)
    .select()
    .single()

  if (error || !caseRow) return res.status(404).json({ error: 'Case not found' })
  res.json({ case: caseRow })
})

// DELETE /api/psychkg-cases/:id
router.delete('/:id', requireAuth, async (req, res) => {
  const org_id = await getOrgId(req.user.id)
  if (!org_id) return res.status(404).json({ error: 'Not found' })

  const { data: caseRow } = await supabaseAdmin
    .from('psychkg_cases')
    .select('id')
    .eq('id', req.params.id)
    .eq('org_id', org_id)
    .single()

  if (!caseRow) return res.status(404).json({ error: 'Case not found' })

  // Delete documents storage if applicable (psychkg_documents have no storage_path yet)
  // Cascade via FK handles psychkg_documents rows

  await supabaseAdmin
    .from('psychkg_cases')
    .delete()
    .eq('id', req.params.id)

  console.log(`[PSYCHKG] Deleted case ${req.params.id} for org ${org_id}`)
  res.json({ message: 'Case deleted' })
})

// ── Documents ─────────────────────────────────────────────────────────────────

// POST /api/psychkg-cases/:id/documents
// Body: { doc_type, title, content? }
router.post('/:id/documents', requireAuth, async (req, res) => {
  const { doc_type, title, content } = req.body
  if (!doc_type || !title) return res.status(400).json({ error: 'doc_type and title are required' })

  const org_id = await getOrgId(req.user.id)
  if (!org_id) return res.status(404).json({ error: 'Not found' })

  // Verify case belongs to org
  const { data: caseRow } = await supabaseAdmin
    .from('psychkg_cases')
    .select('id')
    .eq('id', req.params.id)
    .eq('org_id', org_id)
    .single()

  if (!caseRow) return res.status(404).json({ error: 'Case not found' })

  const { data: doc, error } = await supabaseAdmin
    .from('psychkg_documents')
    .insert({
      case_id:    req.params.id,
      org_id,
      created_by: req.user.id,
      doc_type,
      title,
      content:    content || null,
      status:     'draft',
    })
    .select()
    .single()

  if (error) throw error
  res.status(201).json({ document: doc })
})

// PATCH /api/psychkg-cases/:id/documents/:docId
router.patch('/:id/documents/:docId', requireAuth, async (req, res) => {
  const org_id = await getOrgId(req.user.id)
  if (!org_id) return res.status(404).json({ error: 'Not found' })

  const allowed = ['title', 'content', 'status']
  const updates = Object.fromEntries(
    Object.entries(req.body).filter(([k]) => allowed.includes(k))
  )

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' })
  }

  const { data: doc, error } = await supabaseAdmin
    .from('psychkg_documents')
    .update(updates)
    .eq('id', req.params.docId)
    .eq('case_id', req.params.id)
    .eq('org_id', org_id)
    .select()
    .single()

  if (error || !doc) return res.status(404).json({ error: 'Document not found' })
  res.json({ document: doc })
})

// DELETE /api/psychkg-cases/:id/documents/:docId
router.delete('/:id/documents/:docId', requireAuth, async (req, res) => {
  const org_id = await getOrgId(req.user.id)
  if (!org_id) return res.status(404).json({ error: 'Not found' })

  await supabaseAdmin
    .from('psychkg_documents')
    .delete()
    .eq('id', req.params.docId)
    .eq('case_id', req.params.id)
    .eq('org_id', org_id)

  res.json({ message: 'Document deleted' })
})

export default router