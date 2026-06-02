import express from 'express'
import { sendReferralNotification, sendReferralRewardNotification } from '../lib/emailService.js'
import { supabaseAdmin } from '../lib/supabase.js'
import { requireAuth } from '../middleware/auth.js'
import Stripe from 'stripe'

const router = express.Router()
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

// Discount amounts for referral rewards (in cents)
const REFERRAL_REFERRER_DISCOUNT = 5000 // 50€ off next invoice for referrer
const REFERRAL_REFERRED_DISCOUNT = 5000 // 50€ off next invoice for referred user

async function getProfile(authUserId) {
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name, referral_code, referred_by_profile_id, org_id')
    .eq('auth_user_id', authUserId)
    .single()
  return data
}

// Ensure profile has a referral code (generate if missing)
async function ensureReferralCode(profileId) {
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('referral_code')
    .eq('id', profileId)
    .single()

  if (!data?.referral_code) {
    const code = Math.random().toString(36).toUpperCase().replace(/[^A-Z]/g, '')
      .padEnd(8, 'ABCDEFGH').slice(0, 8)
    await supabaseAdmin
      .from('profiles')
      .update({ referral_code: code })
      .eq('id', profileId)
    return code
  }
  return data.referral_code
}

// GET /api/referral/me
// Returns own referral code and referrer info if applicable
router.get('/me', requireAuth, async (req, res) => {
  const profile = await getProfile(req.user.id)
  if (!profile) return res.status(404).json({ error: 'Profile not found' })

  const code = await ensureReferralCode(profile.id)

  let referrer = null
  if (profile.referred_by_profile_id) {
    const { data: referrerProfile } = await supabaseAdmin
      .from('profiles')
      .select('full_name')
      .eq('id', profile.referred_by_profile_id)
      .single()
    referrer = referrerProfile
  }

  // Get referral stats (how many users this person referred)
  const { count: referralCount } = await supabaseAdmin
    .from('referrals')
    .select('id', { count: 'exact' })
    .eq('referrer_id', profile.id)

  const { count: rewardedCount } = await supabaseAdmin
    .from('referrals')
    .select('id', { count: 'exact' })
    .eq('referrer_id', profile.id)
    .eq('status', 'rewarded')

  res.json({
    referral_code: code,
    referrer_name: referrer?.full_name || null,
    referred_by_id: profile.referred_by_profile_id,
    referral_count: referralCount || 0,
    rewarded_count: rewardedCount || 0,
  })
})

// POST /api/referral/apply
// Body: { code: 'ABCDEFGH' }
// Apply a referral code to the current user's account
router.post('/apply', requireAuth, async (req, res) => {
  const { code } = req.body
  if (!code?.trim()) return res.status(400).json({ error: 'Code erforderlich' })

  const profile = await getProfile(req.user.id)
  if (!profile) return res.status(404).json({ error: 'Profil nicht gefunden' })

  // Already referred
  if (profile.referred_by_profile_id) {
    return res.status(400).json({ error: 'Sie haben bereits einen Empfehlungscode verwendet.' })
  }

  // Find referrer by code
  const { data: referrer } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name, referral_code')
    .eq('referral_code', code.trim().toUpperCase())
    .single()

  if (!referrer) {
    return res.status(404).json({ error: 'Empfehlungscode nicht gefunden. Bitte prüfen Sie die Eingabe.' })
  }

  // Cannot refer yourself
  if (referrer.id === profile.id) {
    return res.status(400).json({ error: 'Sie können sich nicht selbst empfehlen.' })
  }

  // Link referral
  await supabaseAdmin
    .from('profiles')
    .update({ referred_by_profile_id: referrer.id })
    .eq('id', profile.id)

  // Create referral record
  await supabaseAdmin
    .from('referrals')
    .insert({
      referrer_id: referrer.id,
      referred_id: profile.id,
      referred_org_id: profile.org_id,
      status: 'pending',
    })

  console.log(`[REFERRAL] ${profile.full_name} referred by ${referrer.full_name} (code: ${code})`)

  // Get referrer email and send notification
  try {
    const { data: referrerAuth } = await supabaseAdmin.auth.admin.getUserById(
      // Need to get auth_user_id from referrer profile
      (await supabaseAdmin.from('profiles').select('auth_user_id').eq('id', referrer.id).single()).data?.auth_user_id
    )
    if (referrerAuth?.user?.email) {
      sendReferralNotification({
        referrerName:  referrer.full_name || 'Kollegin/Kollege',
        referrerEmail: referrerAuth.user.email,
        referredName:  profile.full_name || 'Ein neuer Nutzer',
      }).catch(err => console.error('[REFERRAL] Notification email failed:', err.message))
    }
  } catch(err) {
    console.error('[REFERRAL] Could not send notification:', err.message)
  }

  res.json({
    success: true,
    referrer_name: referrer.full_name,
  })
})

// POST /api/referral/reward/:referralId
// Called internally when referred user's first payment is confirmed
// Creates a Stripe coupon and applies it to the referrer's subscription
export async function applyReferralReward(referralId) {
  const { data: referral } = await supabaseAdmin
    .from('referrals')
    .select('id, referrer_id, referred_id, status')
    .eq('id', referralId)
    .single()

  if (!referral || referral.status === 'rewarded') return

  // Get referrer's subscription
  const { data: referrerProfile } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name, org_id')
    .eq('id', referral.referrer_id)
    .single()

  if (!referrerProfile?.org_id) return

  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('stripe_customer_id, plan, status')
    .eq('org_id', referrerProfile.org_id)
    .single()

  if (!sub?.stripe_customer_id || sub.status !== 'active') {
    console.log(`[REFERRAL] Referrer ${referrerProfile.full_name} has no active subscription — reward deferred`)
    return
  }

  try {
    // ── Reward referrer (50€ off next invoice) ────────────────
    const referrerCoupon = await stripe.coupons.create({
      amount_off: REFERRAL_REFERRER_DISCOUNT,
      currency: 'eur',
      duration: 'once',
      name: `Empfehlungsbonus — ${referrerProfile.full_name}`,
      max_redemptions: 1,
    })

    await stripe.customers.update(sub.stripe_customer_id, {
      coupon: referrerCoupon.id,
    })

    console.log(`[REFERRAL] Referrer reward: ${referrerProfile.full_name} gets ${REFERRAL_REFERRER_DISCOUNT / 100}€ off (coupon ${referrerCoupon.id})`)

    // Get referred user name for the email
    const { data: referredProfileForEmail } = await supabaseAdmin
      .from('profiles')
      .select('full_name')
      .eq('id', referral.referred_id)
      .single()

    // Send reward notification to referrer
    try {
      const { data: referrerAuthUser } = await supabaseAdmin.auth.admin.getUserById(
        (await supabaseAdmin.from('profiles').select('auth_user_id').eq('id', referral.referrer_id).single()).data?.auth_user_id
      )
      if (referrerAuthUser?.user?.email) {
        sendReferralRewardNotification({
          referrerName:  referrerProfile.full_name || 'Kollegin/Kollege',
          referrerEmail: referrerAuthUser.user.email,
          referredName:  referredProfileForEmail?.full_name || 'Ihr Kollege',
        }).catch(err => console.error('[REFERRAL] Reward email failed:', err.message))
      }
    } catch(err) {
      console.error('[REFERRAL] Could not send reward email:', err.message)
    }

    // ── Reward referred user (50€ off next invoice) ───────────
    const { data: referredProfile } = await supabaseAdmin
      .from('profiles')
      .select('id, full_name, org_id')
      .eq('id', referral.referred_id)
      .single()

    if (referredProfile?.org_id) {
      const { data: referredSub } = await supabaseAdmin
        .from('subscriptions')
        .select('stripe_customer_id, status')
        .eq('org_id', referredProfile.org_id)
        .single()

      if (referredSub?.stripe_customer_id && referredSub.status === 'active') {
        const referredCoupon = await stripe.coupons.create({
          amount_off: REFERRAL_REFERRED_DISCOUNT,
          currency: 'eur',
          duration: 'once',
          name: `Willkommensbonus — ${referredProfile.full_name}`,
          max_redemptions: 1,
        })

        await stripe.customers.update(referredSub.stripe_customer_id, {
          coupon: referredCoupon.id,
        })

        console.log(`[REFERRAL] Referred reward: ${referredProfile.full_name} gets ${REFERRAL_REFERRED_DISCOUNT / 100}€ off (coupon ${referredCoupon.id})`)
      }
    }

    // ── Mark referral as rewarded ─────────────────────────────
    await supabaseAdmin
      .from('referrals')
      .update({
        status: 'rewarded',
        reward_type: 'stripe_coupon',
        stripe_coupon_id: referrerCoupon.id,
        rewarded_at: new Date().toISOString(),
      })
      .eq('id', referralId)

  } catch (err) {
    console.error(`[REFERRAL] Failed to apply reward:`, err.message)
  }
}

export default router