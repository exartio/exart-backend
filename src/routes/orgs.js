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
router.post('/', requireAuth, async (req, res) => {
  const { name, slug } = req.body

  if (!name?.trim()) return res.status(400).json({ error: 'Name ist erforderlich.' })
  if (!slug?.trim()) return res.status(400).json({ error: 'Slug ist erforderlich.' })

  // Check user has no org yet
  const { data: existingMember } = await supabaseAdmin
    .from('organization_members')
    .select('org_id')
    .eq('user_id', req.user.id)
    .single()

  if (existingMember?.org_id) {
    return res.status(400).json({ error: 'User already has an organisation.' })
  }

  // Create org
  const { data: org, error: orgError } = await supabaseAdmin
    .from('organizations')
    .insert({ name: name.trim(), slug: slug.trim() })
    .select()
    .single()

  if (orgError) {
    if (orgError.code === '23505') return res.status(400).json({ error: 'Dieser Name ist bereits vergeben.' })
    throw orgError
  }

  // Add user as owner
  const { error: memberError } = await supabaseAdmin
    .from('organization_members')
    .insert({ org_id: org.id, user_id: req.user.id, role: 'owner' })

  if (memberError) throw memberError

  // Seed BGB suite access
  await supabaseAdmin
    .from('org_suite_access')
    .insert({ org_id: org.id, suite: 'bgb', enabled: true, enabled_at: new Date().toISOString() })

  // Audit log
  await supabaseAdmin.from('audit_log').insert({
    org_id:      org.id,
    user_id:     req.user.id,
    action:      'org.created',
    entity_type: 'organizations',
    entity_id:   org.id,
  })

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

  // ── Suite access ──────────────────────────────────────────
  const { data: suiteRows } = await supabaseAdmin
    .from('org_suite_access')
    .select('suite')
    .eq('org_id', member.org_id)
    .eq('enabled', true)

  const suites = (suiteRows || []).map(r => r.suite)

  res.json({ org, accessLevel, role: member.role || 'sachverstaendige', suites })
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
  const { data: member } = await supabaseAdmin
    .from('organization_members')
    .select('org_id')
    .eq('user_id', req.user.id)
    .single()

  if (!member?.org_id) return res.status(404).json({ error: 'Organisation not found' })

  const { data: members, error } = await supabaseAdmin
    .from('organization_members')
    .select('user_id, role, joined_at')
    .eq('org_id', member.org_id)
    .order('joined_at', { ascending: true })

  if (error) throw error

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

    const { data: verifiedLog } = await supabaseAdmin
      .from('audit_log')
      .select('created_at')
      .eq('action', 'verification.approved')
      .eq('org_id', member.org_id)
      .order('created_at', { ascending: false })
      .limit(1)

    return {
      user_id:             m.user_id,
      full_name:           profile?.full_name || null,
      email,
      role:                m.role || 'sachverstaendige',
      registered_at:       profile?.created_at || m.joined_at,
      verification_status: profile?.verification_status || 'pending',
      verified_at:         verifiedLog?.[0]?.created_at || null,
    }
  }))

  res.json({ members: enriched, org_id: member.org_id })
})

export default router