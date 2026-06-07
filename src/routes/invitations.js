import express from 'express'
import { randomBytes } from 'crypto'
import { supabaseAdmin } from '../lib/supabase.js'
import { requireAuth } from '../middleware/auth.js'
import { sendInvitationEmail } from '../lib/emailService.js'

const router = express.Router()

// Plan limits: { sachverstaendige: max, assistent: max }
// null = unlimited
const PLAN_LIMITS = {
  none:          { sachverstaendige: 1, assistent: 0 },
  unit:          { sachverstaendige: 1, assistent: 0 },
  solo:          { sachverstaendige: 1, assistent: 1 },
  solo_yearly:   { sachverstaendige: 1, assistent: 1 },
  expert:        { sachverstaendige: 2, assistent: 2 },
  expert_yearly: { sachverstaendige: 2, assistent: 2 },
  institution:   { sachverstaendige: null, assistent: null },
}

async function getOrgContext(authUserId) {
  const { data } = await supabaseAdmin
    .from('organization_members')
    .select('org_id, role')
    .eq('user_id', authUserId)
    .single()
  return data
}

// POST /api/invitations/send
// Body: { email, role }
router.post('/send', requireAuth, async (req, res) => {
  const { email } = req.body
  const role = 'assistent' // role is determined by verification, not invitation

  if (!email?.trim()) return res.status(400).json({ error: 'E-Mail-Adresse erforderlich' })

  const orgCtx = await getOrgContext(req.user.id)
  if (!orgCtx?.org_id) return res.status(404).json({ error: 'Organisation nicht gefunden' })

  // Get org info for email
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('name')
    .eq('id', orgCtx.org_id)
    .single()

  // Get inviter profile
  const { data: inviterProfile } = await supabaseAdmin
    .from('profiles')
    .select('full_name')
    .eq('auth_user_id', req.user.id)
    .single()

  // Get current subscription plan
  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('plan, status')
    .eq('org_id', orgCtx.org_id)
    .single()

  const plan = sub?.status === 'active' ? (sub.plan || 'none') : 'none'
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.none
  const totalLimit = (limits.sachverstaendige || 0) + (limits.assistent || 0)

  // Check if total member limit is reached
  if (totalLimit !== null) {
    const { count: currentCount } = await supabaseAdmin
      .from('organization_members')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgCtx.org_id)

    if ((currentCount || 0) >= totalLimit) {
      return res.status(402).json({
        error: `Ihr ${plan}-Plan erlaubt maximal ${totalLimit} Mitglieder. Bitte upgraden Sie Ihren Plan.`,
        reason: 'plan_limit_reached',
        limit: totalLimit,
        current: currentCount,
      })
    }
  }

  // Check if user with this email already exists and is a member
  const { data: { users } } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 })
  const targetUser = users?.find(u => u.email?.toLowerCase() === email.trim().toLowerCase())

  if (targetUser) {
    // Check if already a member
    const { data: existingMember } = await supabaseAdmin
      .from('organization_members')
      .select('id')
      .eq('org_id', orgCtx.org_id)
      .eq('user_id', targetUser.id)
      .single()

    if (existingMember) {
      return res.status(409).json({ error: 'Dieser Nutzer ist bereits Mitglied Ihrer Organisation.' })
    }
  }
  // If user doesn't exist yet, the invitation is still sent — they register first, then accept

  // Check for existing pending invitation
  const { data: existingInvite } = await supabaseAdmin
    .from('invitations')
    .select('id, expires_at')
    .eq('org_id', orgCtx.org_id)
    .eq('email', email.trim().toLowerCase())
    .eq('status', 'pending')
    .single()

  if (existingInvite && new Date(existingInvite.expires_at) > new Date()) {
    return res.status(409).json({ error: 'Es wurde bereits eine Einladung an diese E-Mail-Adresse gesendet.' })
  }

  // Generate token and create invitation
  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

  await supabaseAdmin
    .from('invitations')
    .upsert({
      org_id:     orgCtx.org_id,
      invited_by: req.user.id,
      email:      email.trim().toLowerCase(),
      role,
      token,
      status:     'pending',
      expires_at: expiresAt,
    }, { onConflict: 'token' })

  // Send invitation email
  const acceptUrl = `${process.env.FRONTEND_URL}/einladung-annehmen?token=${token}`
  await sendInvitationEmail({
    recipientEmail: email.trim(),
    inviterName:    inviterProfile?.full_name || 'Ihr Kollege',
    orgName:        org?.name || 'Ihre Organisation',
    role,
    acceptUrl,
  })

  console.log(`[INVITE] Sent invitation to ${email} for org ${orgCtx.org_id} (role: ${role})`)
  res.json({ message: 'Einladung gesendet', email: email.trim() })
})

// GET /api/invitations/accept?token=xxx
// Validates token and returns invite details (called by client-side script)
router.get('/accept', async (req, res) => {
  const { token } = req.query
  const frontendUrl = process.env.FRONTEND_URL || 'https://exart.io'

  if (!token) {
    return res.redirect(`${frontendUrl}/dashboard?invite_error=missing_token`)
  }

  // Validate token
  const { data: invite, error } = await supabaseAdmin
    .from('invitations')
    .select('*')
    .eq('token', token)
    .single()

  if (error || !invite) {
    return res.redirect(`${frontendUrl}/dashboard?invite_error=not_found`)
  }

  if (invite.status !== 'pending') {
    return res.redirect(`${frontendUrl}/dashboard?invite_error=already_used`)
  }

  if (new Date(invite.expires_at) < new Date()) {
    await supabaseAdmin.from('invitations').update({ status: 'expired' }).eq('id', invite.id)
    return res.redirect(`${frontendUrl}/dashboard?invite_error=expired`)
  }

  // Check if user is logged in via Authorization header or cookie
  // Since this is a GET from email link, user may not be logged in
  // Redirect to login first, then back to this URL
  const authHeader = req.headers.authorization
  if (!authHeader) {
    const returnUrl = encodeURIComponent(`/api/invitations/accept?token=${token}`)
    return res.redirect(`${frontendUrl}/login?redirect=${returnUrl}`)
  }

  // Verify JWT
  const jwt = authHeader.replace('Bearer ', '')
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(jwt)

  if (authError || !user) {
    const returnUrl = encodeURIComponent(`/api/invitations/accept?token=${token}`)
    return res.redirect(`${frontendUrl}/login?redirect=${returnUrl}`)
  }

  // Verify email matches
  if (user.email?.toLowerCase() !== invite.email.toLowerCase()) {
    return res.redirect(`${frontendUrl}/dashboard?invite_error=wrong_email&expected=${encodeURIComponent(invite.email)}`)
  }

  // Check if already a member
  const { data: existing } = await supabaseAdmin
    .from('organization_members')
    .select('id')
    .eq('org_id', invite.org_id)
    .eq('user_id', user.id)
    .single()

  if (!existing) {
    // Add to organisation
    await supabaseAdmin
      .from('organization_members')
      .insert({ org_id: invite.org_id, user_id: user.id, role: invite.role })

    // Update profile org_id
    await supabaseAdmin
      .from('profiles')
      .update({ org_id: invite.org_id })
      .eq('auth_user_id', user.id)

    console.log(`[INVITE] User ${user.id} accepted invitation to org ${invite.org_id}`)
  }

  // Mark accepted
  await supabaseAdmin
    .from('invitations')
    .update({ status: 'accepted' })
    .eq('id', invite.id)

  return res.redirect(`${frontendUrl}/dashboard?invite_success=true`)
})

// GET /api/invitations/pending
// List pending invitations for the org
router.get('/pending', requireAuth, async (req, res) => {
  const orgCtx = await getOrgContext(req.user.id)
  if (!orgCtx?.org_id) return res.status(404).json({ error: 'Not found' })

  const { data: invites } = await supabaseAdmin
    .from('invitations')
    .select('id, email, role, status, created_at, expires_at')
    .eq('org_id', orgCtx.org_id)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })

  res.json({ invitations: invites || [] })
})

export default router