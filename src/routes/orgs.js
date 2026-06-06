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

// POST /api/orgs
// Create a new organisation for the current user (onboarding)
router.post('/', requireAuth, async (req, res) => {
  const { name, slug } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'Name ist erforderlich.' })

  const profile = await getUserContext(req.user.id)
  if (!profile) return res.status(400).json({ error: 'Profil nicht gefunden.' })

  // Check user doesn't already have an org
  const { data: existingMember } = await supabaseAdmin
    .from('organization_members')
    .select('org_id')
    .eq('user_id', req.user.id)
    .single()

  if (existingMember?.org_id) {
    return res.status(409).json({ error: 'Sie sind bereits Mitglied einer Organisation.' })
  }

  // Create org
  const { data: org, error: orgError } = await supabaseAdmin
    .from('organizations')
    .insert({ name: name.trim() })
    .select()
    .single()

  if (orgError) throw orgError

  // Add user as owner
  const { error: memberError } = await supabaseAdmin
    .from('organization_members')
    .insert({ org_id: org.id, user_id: req.user.id, role: 'owner' })

  if (memberError) throw memberError

  // Link profile to org
  await supabaseAdmin
    .from('profiles')
    .update({ org_id: org.id })
    .eq('auth_user_id', req.user.id)

  // Create subscription row (inactive placeholder)
  await supabaseAdmin
    .from('subscriptions')
    .insert({ org_id: org.id, plan: 'none', status: 'none' })

  res.status(201).json({ org })
})

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

// POST /api/orgs
// Create a new organisation for the current user (onboarding)
router.post('/', requireAuth, async (req, res) => {
  const { name, slug } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'Name ist erforderlich.' })

  const profile = await getUserContext(req.user.id)
  if (!profile) return res.status(400).json({ error: 'Profil nicht gefunden.' })

  // Check user doesn't already have an org
  const { data: existingMember } = await supabaseAdmin
    .from('organization_members')
    .select('org_id')
    .eq('user_id', req.user.id)
    .single()

  if (existingMember?.org_id) {
    return res.status(409).json({ error: 'Sie sind bereits Mitglied einer Organisation.' })
  }

  // Create org
  const { data: org, error: orgError } = await supabaseAdmin
    .from('organizations')
    .insert({ name: name.trim() })
    .select()
    .single()

  if (orgError) throw orgError

  // Add user as owner
  const { error: memberError } = await supabaseAdmin
    .from('organization_members')
    .insert({ org_id: org.id, user_id: req.user.id, role: 'owner' })

  if (memberError) throw memberError

  // Link profile to org
  await supabaseAdmin
    .from('profiles')
    .update({ org_id: org.id })
    .eq('auth_user_id', req.user.id)

  // Create subscription row (inactive placeholder)
  await supabaseAdmin
    .from('subscriptions')
    .insert({ org_id: org.id, plan: 'none', status: 'none' })

  res.status(201).json({ org })
})

// GET /api/orgs/members
// Returns all members of the user's organisation with profile and auth data
router.get('/members', requireAuth, async (req, res) => {
  const { data: member } = await supabaseAdmin
    .from('organization_members')
    .select('org_id')
    .eq('user_id', req.user.id)
    .single()

  if (!member?.org_id) return res.status(404).json({ error: 'Organisation not found' })

  // Get all members of this org
  const { data: members, error } = await supabaseAdmin
    .from('organization_members')
    .select('user_id, role, created_at')
    .eq('org_id', member.org_id)
    .order('created_at', { ascending: true })

  if (error) throw error

  // Enrich with profile and auth data
  const enriched = await Promise.all((members || []).map(async m => {
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('full_name, verification_status, created_at')
      .eq('auth_user_id', m.user_id)
      .single()

    let email = null
    try {
      const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(m.user_id)
      email = authUser?.user?.email || null
    } catch(e) {}

    // Determine verified_at from audit_log if available
    const { data: verifiedLog } = await supabaseAdmin
      .from('audit_log')
      .select('created_at')
      .eq('action', 'verification.approved')
      .eq('org_id', member.org_id)
      .order('created_at', { ascending: false })
      .limit(1)

    return {
      user_id:              m.user_id,
      full_name:            profile?.full_name || null,
      email,
      role:                 m.role || 'sachverstaendige',
      registered_at:        profile?.created_at || m.created_at,
      verification_status:  profile?.verification_status || 'pending',
      verified_at:          verifiedLog?.[0]?.created_at || null,
    }
  }))

  res.json({ members: enriched, org_id: member.org_id })
})

export default router