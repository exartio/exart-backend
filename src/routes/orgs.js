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
router.get('/members', requireAuth, async (req, res) => {
  // Find the caller's org
  const { data: caller } = await supabaseAdmin
    .from('organization_members')
    .select('org_id')
    .eq('user_id', req.user.id)
    .single()

  if (!caller?.org_id) return res.status(404).json({ error: 'Organisation not found' })

  // Fetch all org members
  const { data: members, error } = await supabaseAdmin
    .from('organization_members')
    .select('user_id, role, created_at')
    .eq('org_id', caller.org_id)
    .order('created_at', { ascending: true })

  if (error) throw error
  if (!members || members.length === 0) return res.json({ members: [], org_id: caller.org_id })

  const userIds = members.map(m => m.user_id)

  // Batch fetch profiles (single query)
  const { data: profiles } = await supabaseAdmin
    .from('profiles')
    .select('auth_user_id, full_name, verification_status, created_at')
    .in('auth_user_id', userIds)

  const profileMap = {}
  ;(profiles || []).forEach(p => { profileMap[p.auth_user_id] = p })

  // Batch fetch emails via auth admin (single call, not N+1)
  const emailMap = {}
  try {
    const { data: { users } } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 })
    const orgUserSet = new Set(userIds)
    ;(users || []).forEach(u => {
      if (orgUserSet.has(u.id)) emailMap[u.id] = u.email || null
    })
  } catch(e) {
    console.error('[MEMBERS] auth.admin.listUsers failed:', e.message)
    // Continue without emails rather than failing the whole request
  }

  const enriched = members.map(m => {
    const profile = profileMap[m.user_id] || {}
    return {
      user_id:             m.user_id,
      full_name:           profile.full_name || null,
      email:               emailMap[m.user_id] || null,
      role:                m.role || 'sachverstaendige',
      registered_at:       profile.created_at || m.created_at,
      verification_status: profile.verification_status || 'unsubmitted',
    }
  })

  res.json({ members: enriched, org_id: caller.org_id })
})

export default router