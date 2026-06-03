import express from 'express'
import { supabaseAdmin } from '../lib/supabase.js'
import { requireAuth } from '../middleware/auth.js'

const router = express.Router()

async function getUserContext(authUserId) {
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('id, org_id')
    .eq('auth_user_id', authUserId)
    .single()
  return data
}

// GET /api/abrechnung/:caseId
// Load saved Abrechnung state for a case
router.get('/:caseId', requireAuth, async (req, res) => {
  const profile = await getUserContext(req.user.id)
  if (!profile?.org_id) return res.status(404).json({ error: 'Not found' })

  const { data, error } = await supabaseAdmin
    .from('abrechnungen')
    .select('id, case_id, state, updated_at')
    .eq('case_id', req.params.caseId)
    .eq('org_id', profile.org_id)
    .single()

  if (error && error.code !== 'PGRST116') throw error // PGRST116 = not found
  res.json({ abrechnung: data || null })
})

// POST /api/abrechnung/:caseId
// Save or update Abrechnung state for a case (upsert)
router.post('/:caseId', requireAuth, async (req, res) => {
  const { state } = req.body
  if (!state) return res.status(400).json({ error: 'state required' })

  const profile = await getUserContext(req.user.id)
  if (!profile?.org_id) return res.status(404).json({ error: 'Not found' })

  // Verify case belongs to org
  const { data: caseRow } = await supabaseAdmin
    .from('cases')
    .select('id')
    .eq('id', req.params.caseId)
    .eq('org_id', profile.org_id)
    .single()

  if (!caseRow) return res.status(404).json({ error: 'Case not found' })

  const { data, error } = await supabaseAdmin
    .from('abrechnungen')
    .upsert({
      case_id:    req.params.caseId,
      org_id:     profile.org_id,
      state,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'case_id' })
    .select('id, updated_at')
    .single()

  if (error) throw error
  res.json({ abrechnung: data })
})

export default router