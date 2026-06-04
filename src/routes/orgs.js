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

  res.json({ org, accessLevel, role: member.role || 'sachverstaendige' })
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

// GET /api/orgs/members
// Returns all members of the user's organisation with profile data
router.get('/members', requireAuth, async (req, res) => {
  const { data: member } = await supabaseAdmin
    .from('organization_members')
    .select('org_id')
    .eq('user_id', req.user.id)
    .single()

  if (!member?.org_id) return res.status(404).json({ error: 'Organisation not found' })

  // Get all member user_ids for this org
  const { data: members, error } = await supabaseAdmin
    .from('organization_members')
    .select('user_id, role')
    .eq('org_id', member.org_id)

  if (error) throw error

  const userIds = (members || []).map(m => m.user_id)

  // Fetch all profiles in one query
  const { data: profiles } = await supabaseAdmin
    .from('profiles')
    .select('auth_user_id, full_name, email, verification_status, created_at')
    .in('auth_user_id', userIds)

  const profileMap = {}
  ;(profiles || []).forEach(p => { profileMap[p.auth_user_id] = p })

  const enriched = (members || []).map(m => {
    const p = profileMap[m.user_id] || {}
    return {
      user_id:             m.user_id,
      full_name:           p.full_name || null,
      email:               p.email || null,
      role:                m.role || 'sachverstaendige',
      registered_at:       p.created_at || null,
      verification_status: p.verification_status || 'pending',
      verified_at:         null,
    }
  })

  res.json({ members: enriched, org_id: member.org_id })
})

export default router