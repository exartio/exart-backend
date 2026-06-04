import express from 'express'
import { checkGenerationQuota, PLAN_LIMITS } from '../lib/quotaService.js'
import { supabaseAdmin } from '../lib/supabase.js'
import { requireAuth } from '../middleware/auth.js'
import Stripe from 'stripe'

const router = express.Router()
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

// GET /api/subscriptions/me
router.get('/me', requireAuth, async (req, res) => {
  const { data: member } = await supabaseAdmin
    .from('organization_members')
    .select('org_id')
    .eq('user_id', req.user.id)
    .single()

  if (!member) {
    return res.json({ plan_name: null, status: 'none', current_period_end: null, quota: null })
  }

  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('*')
    .eq('org_id', member.org_id)
    .single()

  if (!sub) {
    return res.json({ plan_name: null, status: 'none', current_period_end: null, quota: null })
  }

  const planNames = {
    solo:          'Solo-Lizenz',
    solo_yearly:   'Solo-Lizenz (jährlich)',
    expert:        'Expert-Lizenz',
    expert_yearly: 'Expert-Lizenz (jährlich)',
    unit:          'Einzelgutachten',
    none:          'Kein aktiver Plan',
  }

  // Build quota info
  const planConfig = PLAN_LIMITS[sub.plan] || PLAN_LIMITS.none
  const addonUnits = sub.addon_unit_count || 0
  let quota = null
  if (planConfig.type === 'monthly') {
    const effectiveLimit = planConfig.limit + addonUnits
    quota = { type: 'monthly', used: sub.monthly_count || 0, limit: effectiveLimit, base_limit: planConfig.limit, addon_units: addonUnits }
  } else if (planConfig.type === 'total') {
    quota = { type: 'total', used: sub.gutachten_count || 0, limit: planConfig.limit }
  } else if (planConfig.type === 'unlimited') {
    quota = { type: 'unlimited', used: null, limit: null }
  }

  res.json({
    plan_name: planNames[sub.plan] || sub.plan,
    plan_key: sub.plan,
    status: sub.status,
    current_period_end: sub.current_period_end,
    quota,
  })
})

// GET /api/subscriptions/quota?case_id=<uuid>
// Quick quota check for frontend
router.get('/quota', requireAuth, async (req, res) => {
  const { case_id } = req.query
  if (!case_id) return res.json({ allowed: true, reason: null, count: 0, max: 3 })

  const quota = await checkGenerationQuota(case_id)
  res.json(quota)
})

// POST /api/subscriptions/portal
router.post('/portal', requireAuth, async (req, res) => {
  const { data: member } = await supabaseAdmin
    .from('organization_members')
    .select('org_id')
    .eq('user_id', req.user.id)
    .single()

  if (!member) return res.status(400).json({ error: 'No organisation found' })

  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('org_id', member.org_id)
    .single()

  if (!sub?.stripe_customer_id) {
    return res.status(404).json({ error: 'No Stripe customer found' })
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: sub.stripe_customer_id,
    return_url: `${process.env.FRONTEND_URL}/dashboard-settings`,
  })

  res.json({ url: session.url })
})

export default router