import express from 'express'
import { supabaseAdmin } from '../lib/supabase.js'
import { requireAuth, checkAccess } from '../middleware/auth.js'

const router = express.Router()

async function getUserContext(authUserId) {
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('id, org_id')
    .eq('auth_user_id', authUserId)
    .single()
  return data
}

// GET /api/cases
// List all cases for the user's org
router.get('/', requireAuth, async (req, res) => {
  const profile = await getUserContext(req.user.id)
  if (!profile?.org_id) return res.json({ cases: [] })

  const { data: cases, error } = await supabaseAdmin
    .from('cases')
    .select(`
      id, patient_ref, title, status, statement_ids, beweisfragen, generation_count, max_generations, aktenzeichen, gericht, richter, beschlussdatum, beauftragungsdatum, abgabefrist, honorar_erwartung, submitted_at, betroffener_name, betroffener_dob, betroffener_adresse, created_at, updated_at,
      case_documents ( id, doc_type, status, ignored ),
      generated_outputs ( id, version, is_demo, output_status, prompt_snapshot ),
      templates ( id, name )
    `)
    .eq('org_id', profile.org_id)
    .order('updated_at', { ascending: false })

  if (error) throw error
  res.json({ cases })
})

// GET /api/cases/:id
// Get a single case with documents and outputs
router.get('/:id', requireAuth, async (req, res) => {
  const profile = await getUserContext(req.user.id)
  if (!profile?.org_id) return res.status(404).json({ error: 'Case not found' })

  const { data: caseRow, error } = await supabaseAdmin
    .from('cases')
    .select(`
      id, org_id, title, patient_ref, status, template_id,
      aktenzeichen, gericht, richter, beschlussdatum, beauftragungsdatum,
      abgabefrist, honorar_erwartung, submitted_at,
      betroffener_name, betroffener_dob, betroffener_adresse,
      beweisfragen, beweisfragen_raw_text, gerichtsbeschluss_status,
      gerichtsbeschluss_storage_path, statement_ids,
      generation_count, max_generations, created_at, updated_at,
      case_documents ( id, file_name, doc_type, status, extracted_text, ignored, storage_path, created_at ),
      generated_outputs ( id, version, is_demo, output_status, created_at, prompt_snapshot )
    `)
    .eq('id', req.params.id)
    .eq('org_id', profile.org_id)
    .single()

  if (error || !caseRow) return res.status(404).json({ error: 'Case not found' })
  res.json({ case: caseRow })
})

// POST /api/cases
// Create a new case
// Body: { patient_ref, title, template_id? }
router.post('/', requireAuth, checkAccess, async (req, res) => {
  const { patient_ref, title, template_id } = req.body

  if (!patient_ref || !title) {
    return res.status(400).json({ error: 'patient_ref and title are required' })
  }

  const profile = await getUserContext(req.user.id)
  if (!profile?.org_id) {
    return res.status(400).json({ error: 'User has no organisation' })
  }

  const { data: caseRow, error } = await supabaseAdmin
    .from('cases')
    .insert({
      org_id: profile.org_id,
      created_by: profile.id,
      patient_ref,
      title,
      template_id: template_id || null,
      statement_ids: [],
    })
    .select()
    .single()

  if (error) throw error

  await supabaseAdmin.from('audit_log').insert({
    org_id: profile.org_id,
    user_id: req.user.id,
    action: 'case.created',
    entity_type: 'cases',
    entity_id: caseRow.id,
  })

  res.status(201).json({ case: caseRow })
})

// PATCH /api/cases/:id
// Update case fields
// Body: any of { title, status, assigned_to, template_id, patient_ref }
router.patch('/:id', requireAuth, async (req, res) => {
  const profile = await getUserContext(req.user.id)
  if (!profile?.org_id) return res.status(404).json({ error: 'Case not found' })

  const allowed = ['title', 'status', 'assigned_to', 'template_id', 'patient_ref', 'beweisfragen']
  const updates = Object.fromEntries(
    Object.entries(req.body).filter(([k]) => allowed.includes(k))
  )

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' })
  }

  const { data: caseRow, error } = await supabaseAdmin
    .from('cases')
    .update(updates)
    .eq('id', req.params.id)
    .eq('org_id', profile.org_id)
    .select()
    .single()

  if (error || !caseRow) return res.status(404).json({ error: 'Case not found' })
  res.json({ case: caseRow })
})

// PATCH /api/cases/:id/statements
// Set which past statements to use for this case
// Body: { mode: 'all' | 'none' | 'select', statement_ids?: uuid[] }
router.patch('/:id/statements', requireAuth, async (req, res) => {
  const { mode, statement_ids = [] } = req.body

  if (!['all', 'none', 'select'].includes(mode)) {
    return res.status(400).json({ error: 'mode must be all, none, or select' })
  }

  const profile = await getUserContext(req.user.id)
  if (!profile?.org_id) return res.status(404).json({ error: 'Case not found' })

  // Verify case belongs to org
  const { data: caseRow } = await supabaseAdmin
    .from('cases')
    .select('id')
    .eq('id', req.params.id)
    .eq('org_id', profile.org_id)
    .single()

  if (!caseRow) return res.status(404).json({ error: 'Case not found' })

  let resolvedIds = []

  if (mode === 'all') {
    // Fetch all ready statements for this user
    const { data: statements } = await supabaseAdmin
      .from('past_statements')
      .select('id')
      .eq('user_id', profile.id)
      .eq('status', 'ready')
    resolvedIds = (statements || []).map(s => s.id)
  } else if (mode === 'select') {
    // Validate provided IDs belong to this user
    const { data: statements } = await supabaseAdmin
      .from('past_statements')
      .select('id')
      .in('id', statement_ids)
      .eq('user_id', profile.id)
    resolvedIds = (statements || []).map(s => s.id)
  }
  // mode === 'none' → resolvedIds stays []

  const { data: updated, error } = await supabaseAdmin
    .from('cases')
    .update({ statement_ids: resolvedIds })
    .eq('id', req.params.id)
    .select()
    .single()

  if (error) throw error
  res.json({ case: updated })
})

// POST /api/cases/:id/submit
// Mark a case as submitted with timestamp
router.post('/:id/submit', requireAuth, async (req, res) => {
  const profile = await getUserContext(req.user.id)
  if (!profile?.org_id) return res.status(404).json({ error: 'Not found' })

  const { data: caseRow } = await supabaseAdmin
    .from('cases')
    .select('id, status')
    .eq('id', req.params.id)
    .eq('org_id', profile.org_id)
    .single()

  if (!caseRow) return res.status(404).json({ error: 'Case not found' })

  const { data, error } = await supabaseAdmin
    .from('cases')
    .update({
      status:       'submitted',
      submitted_at: new Date().toISOString(),
    })
    .eq('id', req.params.id)
    .select('id, status, submitted_at')
    .single()

  if (error) throw error

  await supabaseAdmin.from('audit_log').insert({
    org_id:      profile.org_id,
    user_id:     req.user.id,
    action:      'case.submitted',
    entity_type: 'cases',
    entity_id:   req.params.id,
    metadata:    { submitted_at: data.submitted_at },
  })

  console.log(`[CASE] Submitted case ${req.params.id} at ${data.submitted_at}`)
  res.json({ case: data })
})


// DELETE /api/cases/:id
// Deletes a case and all associated documents, outputs and storage files
router.delete('/:id', requireAuth, async (req, res) => {
  const profile = await getUserContext(req.user.id)
  if (!profile?.org_id) return res.status(404).json({ error: 'Not found' })

  // Verify ownership
  const { data: caseRow } = await supabaseAdmin
    .from('cases')
    .select('id, org_id')
    .eq('id', req.params.id)
    .eq('org_id', profile.org_id)
    .single()

  if (!caseRow) return res.status(404).json({ error: 'Case not found' })

  // Delete case documents from storage
  const { data: docs } = await supabaseAdmin
    .from('case_documents')
    .select('storage_path')
    .eq('case_id', req.params.id)

  if (docs?.length > 0) {
    const paths = docs.map(d => d.storage_path).filter(Boolean)
    if (paths.length > 0) {
      await supabaseAdmin.storage.from('case-documents').remove(paths)
    }
  }

  // Delete exported files from storage
  const { data: exports } = await supabaseAdmin
    .from('exports')
    .select('storage_path')
    .eq('case_id', req.params.id)

  if (exports?.length > 0) {
    const paths = exports.map(e => e.storage_path).filter(Boolean)
    if (paths.length > 0) {
      await supabaseAdmin.storage.from('exports').remove(paths)
    }
  }

  // Delete court order from storage if exists
  const { data: fullCase } = await supabaseAdmin
    .from('cases')
    .select('gerichtsbeschluss_storage_path')
    .eq('id', req.params.id)
    .single()

  if (fullCase?.gerichtsbeschluss_storage_path) {
    await supabaseAdmin.storage
      .from('case-documents')
      .remove([fullCase.gerichtsbeschluss_storage_path])
  }

  // Delete case (cascades to case_documents, generated_outputs, exports via FK)
  await supabaseAdmin
    .from('cases')
    .delete()
    .eq('id', req.params.id)

  console.log(`[CASE] Deleted case ${req.params.id} for org ${profile.org_id}`)
  res.json({ message: 'Case deleted' })
})


export default router