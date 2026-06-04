import express from 'express'
import { supabaseAdmin } from '../lib/supabase.js'
import { sendVerificationApproved, sendWelcomeEmail } from '../lib/emailService.js'

const router = express.Router()

// POST /api/verification/webhook
// Called by Supabase Database Webhook when verification_status changes to 'verified'
// Secured with a shared secret in the Authorization header
router.post('/webhook', async (req, res) => {
  // Verify webhook secret
  const secret = req.headers['x-webhook-secret']
  if (!secret || secret !== process.env.VERIFICATION_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const record = req.body?.record
    const oldRecord = req.body?.old_record

    // Only fire when status changes TO 'verified'
    if (!record || record.verification_status !== 'verified') {
      return res.json({ message: 'No action needed' })
    }

    // Skip if it was already verified (no change)
    if (oldRecord?.verification_status === 'verified') {
      return res.json({ message: 'Already verified, skipping' })
    }

    const profileId = record.id
    const fullName  = record.full_name || 'Nutzer'

    // Get auth user email via auth_user_id
    const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.getUserById(
      record.auth_user_id
    )

    if (authError || !authUser?.user?.email) {
      console.error('[VERIF] Could not find auth user for profile', profileId, authError?.message)
      return res.status(500).json({ error: 'Could not find user email' })
    }

    const email = authUser.user.email
    console.log(`[VERIF] Sending approval email to ${email} (${fullName})`)

    await sendVerificationApproved({ fullName, email })
    console.log(`[VERIF] Approval email sent to ${email}`)

    // Grant 1 free Gutachten on first verification if org has no active plan
    try {
      const { data: member } = await supabaseAdmin
        .from('organization_members')
        .select('org_id')
        .eq('user_id', record.auth_user_id)
        .single()

      if (member?.org_id) {
        const { data: sub } = await supabaseAdmin
          .from('subscriptions')
          .select('plan, status, addon_unit_count')
          .eq('org_id', member.org_id)
          .single()

        const hasNoActivePlan = !sub || sub.status !== 'active' || sub.plan === 'none'
        const notYetGranted   = !sub || (sub.addon_unit_count || 0) === 0

        if (hasNoActivePlan && notYetGranted) {
          await supabaseAdmin
            .from('subscriptions')
            .upsert({
              org_id:           member.org_id,
              plan:             'none',
              status:           'none',
              addon_unit_count: 1,
            }, { onConflict: 'org_id' })
          console.log(`[VERIF] Free Gutachten granted for org ${member.org_id}`)
        }
      }
    } catch (grantErr) {
      // Non-fatal — log but don't fail the webhook response
      console.error('[VERIF] Failed to grant free Gutachten:', grantErr.message)
    }

    res.json({ message: 'Approval email sent' })

  } catch (err) {
    console.error('[VERIF] Webhook error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/verification/approve
// Manual trigger — admin can call this directly if needed
// Body: { profile_id }
router.post('/approve', async (req, res) => {
  const secret = req.headers['x-webhook-secret']
  if (!secret || secret !== process.env.VERIFICATION_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { profile_id } = req.body
  if (!profile_id) return res.status(400).json({ error: 'profile_id required' })

  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name, auth_user_id, verification_status')
    .eq('id', profile_id)
    .single()

  if (error || !profile) return res.status(404).json({ error: 'Profile not found' })

  const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(profile.auth_user_id)
  if (!authUser?.user?.email) return res.status(404).json({ error: 'Email not found' })

  await sendVerificationApproved({
    fullName: profile.full_name || 'Nutzer',
    email: authUser.user.email,
  })

  res.json({ message: 'Approval email sent', email: authUser.user.email })
})

export default router