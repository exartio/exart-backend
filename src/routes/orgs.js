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

// GET /api/orgs/me
router.get('/me', requireAuth, async (req, res) => {
  const { data: member } = await supabaseAdmin
    .from('organization_members')
    .select('org_id')
    .eq('user_id', req.user.id)
    .single()

  if (!member?.org_id) return res.status(404).json({ error: 'Organisation not found' })

  const { data: org, error } = await supabaseAdmin
    .from('organizations')
    .select('id, name, address, footer_settings, has_verified_physician, created_at')
    .eq('id', member.org_id)
    .single()

  if (error) throw error

  // Check subscription status for accessLevel
  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('status, plan')
    .eq('org_id', member.org_id)
    .single()

  const hasActiveSub = sub?.status === 'active' || sub?.status === 'trialing'
  const hasPhysician = org?.has_verified_physician === true

  let accessLevel = 'none'
  if (hasActiveSub && hasPhysician) accessLevel = 'full'
  else if (hasActiveSub || hasPhysician) accessLevel = 'demo'

  res.json({ org, accessLevel })
})

// PATCH /api/orgs/me
// Update org name, address, footer_settings
router.patch('/me', requireAuth, async (req, res) => {
  const { data: member } = await supabaseAdmin
    .from('organization_members')
    .select('org_id')
    .eq('user_id', req.user.id)
    .single()

  if (!member?.org_id) return res.status(404).json({ error: 'Organisation not found' })

  const allowed = ['name', 'address', 'footer_settings']
  const updates = {}
  allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k] })
  updates.updated_at = new Date().toISOString()

  const { data: org, error } = await supabaseAdmin
    .from('organizations')
    .update(updates)
    .eq('id', member.org_id)
    .select()
    .single()

  if (error) throw error
  res.json({ org })
})

export default router