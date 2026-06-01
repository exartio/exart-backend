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
      id, patient_ref, title, status, statement_ids, beweisfragen, created_at, updated_at,
      created_by ( id, full_name ),
      assigned_to ( id, full_name ),
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
      *,
      created_by ( id, full_name, title ),
      assigned_to ( id, full_name, title ),
      templates ( id, name, content_json ),
      case_documents ( * ),
      generated_outputs ( id, version, is_demo, created_at, created_by ( full_name ) )
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

export default router