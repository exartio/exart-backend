import express from 'express'
import { supabaseAdmin } from '../lib/supabase.js'
import { requireAuth, checkAccess } from '../middleware/auth.js'

const router = express.Router()

// POST /api/orgs
// Creates a new organisation and makes the creator the owner
// Body: { name, slug }
router.post('/', requireAuth, async (req, res) => {
  const { name, slug } = req.body

  if (!name || !slug) {
    return res.status(400).json({ error: 'name and slug are required' })
  }

  if (!/^[a-z0-9-]+$/.test(slug)) {
    return res.status(400).json({
      error: 'Slug may only contain lowercase letters, numbers, and hyphens',
    })
  }

  const { data: existing } = await supabaseAdmin
    .from('organization_members')
    .select('id')
    .eq('user_id', req.user.id)
    .single()

  if (existing) {
    return res.status(400).json({ error: 'User already belongs to an organisation' })
  }

  const { data: org, error: orgError } = await supabaseAdmin
    .from('organizations')
    .insert({ name, slug })
    .select()
    .single()

  if (orgError) {
    if (orgError.code === '23505') {
      return res.status(409).json({ error: 'Slug already taken' })
    }
    throw orgError
  }

  await supabaseAdmin.from('organization_members').insert({
    org_id: org.id,
    user_id: req.user.id,
    role: 'owner',
  })

  await supabaseAdmin
    .from('profiles')
    .update({ org_id: org.id })
    .eq('auth_user_id', req.user.id)

  res.status(201).json({ org })
})


// GET /api/orgs/me
// Returns the user's org, subscription, and access level
router.get('/me', requireAuth, async (req, res) => {
  const { data: member } = await supabaseAdmin
    .from('organization_members')
    .select(`
      role,
      organizations (
        id, name, slug, status, has_verified_physician,
        subscriptions ( plan, status, current_period_end )
      )
    `)
    .eq('user_id', req.user.id)
    .single()

  if (!member) {
    return res.json({ org: null, accessLevel: 'none' })
  }

  const { data: accessLevel } = await supabaseAdmin
    .rpc('check_org_access', { p_user_id: req.user.id })

  res.json({
    org: member.organizations,
    role: member.role,
    accessLevel,
  })
})


// POST /api/orgs/invite
// Invites a user to the org by email
// Body: { email, role }
router.post('/invite', requireAuth, async (req, res) => {
  const { email, role = 'member' } = req.body

  if (!email) return res.status(400).json({ error: 'Email is required' })

  const { data: member } = await supabaseAdmin
    .from('organization_members')
    .select('org_id, role')
    .eq('user_id', req.user.id)
    .single()

  if (!member || !['owner', 'admin'].includes(member.role)) {
    return res.status(403).json({ error: 'Only admins can invite members' })
  }

  const { data: inviterProfile } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('auth_user_id', req.user.id)
    .single()

  const { data: invitation, error } = await supabaseAdmin
    .from('invitations')
    .insert({
      org_id: member.org_id,
      invited_by: inviterProfile.id,
      email,
      role,
    })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'An invitation for this email already exists' })
    }
    throw error
  }

  // TODO: send invitation email via Resend / Postmark
  // Link: ${process.env.FRONTEND_URL}/accept-invite?token=${invitation.token}

  res.status(201).json({
    message: 'Invitation created',
    token: invitation.token, // remove in production — send via email only
  })
})


// POST /api/orgs/accept-invite
// Accepts an invitation token and adds the user to the org
// Body: { token }
router.post('/accept-invite', requireAuth, async (req, res) => {
  const { token } = req.body
  if (!token) return res.status(400).json({ error: 'Token is required' })

  const { data: invite } = await supabaseAdmin
    .from('invitations')
    .select('*')
    .eq('token', token)
    .eq('status', 'pending')
    .single()

  if (!invite) {
    return res.status(404).json({ error: 'Invitation not found or already used' })
  }

  if (new Date(invite.expires_at) < new Date()) {
    await supabaseAdmin
      .from('invitations')
      .update({ status: 'expired' })
      .eq('id', invite.id)
    return res.status(410).json({ error: 'Invitation has expired' })
  }

  const { data: existing } = await supabaseAdmin
    .from('organization_members')
    .select('id')
    .eq('user_id', req.user.id)
    .single()

  if (existing) {
    return res.status(400).json({ error: 'User already belongs to an organisation' })
  }

  await supabaseAdmin.from('organization_members').insert({
    org_id: invite.org_id,
    user_id: req.user.id,
    role: invite.role,
  })

  await supabaseAdmin
    .from('profiles')
    .update({ org_id: invite.org_id })
    .eq('auth_user_id', req.user.id)

  await supabaseAdmin
    .from('invitations')
    .update({ status: 'accepted' })
    .eq('id', invite.id)

  res.json({ message: 'Joined organisation successfully' })
})

export default router
