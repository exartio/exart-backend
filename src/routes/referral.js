import express from 'express'
import { supabaseAdmin } from '../lib/supabase.js'
import { requireAuth } from '../middleware/auth.js'
import Stripe from 'stripe'

const router = express.Router()
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

// Discount amount for referral reward (in cents)
const REFERRAL_DISCOUNT_AMOUNT = 1490 // 14.90€ — one month solo price
const REFERRAL_DISCOUNT_PERCENT = 10  // fallback: 10% off next invoice

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
    // Create a one-time Stripe coupon for the referrer
    const coupon = await stripe.coupons.create({
      amount_off: REFERRAL_DISCOUNT_AMOUNT,
      currency: 'eur',
      duration: 'once',
      name: `Empfehlungsbonus — ${referrerProfile.full_name}`,
      max_redemptions: 1,
    })

    // Apply coupon to referrer's customer
    await stripe.customers.update(sub.stripe_customer_id, {
      coupon: coupon.id,
    })

    // Mark referral as rewarded
    await supabaseAdmin
      .from('referrals')
      .update({
        status: 'rewarded',
        reward_type: 'stripe_coupon',
        stripe_coupon_id: coupon.id,
        rewarded_at: new Date().toISOString(),
      })
      .eq('id', referralId)

    console.log(`[REFERRAL] Reward applied to ${referrerProfile.full_name}: coupon ${coupon.id} (${REFERRAL_DISCOUNT_AMOUNT / 100}€ off)`)

  } catch (err) {
    console.error(`[REFERRAL] Failed to apply reward:`, err.message)
  }
}

export default router