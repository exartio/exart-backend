import express from 'express'
import { supabaseAdmin } from '../lib/supabase.js'
import { requireAuth } from '../middleware/auth.js'
import Stripe from 'stripe'

const router = express.Router()
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

// Plan limits
export const PLAN_LIMITS = {
  none:          { type: 'none',     limit: 0,    period: null },
  solo:          { type: 'monthly',  limit: 5,    period: 'month' },
  solo_yearly:   { type: 'monthly',  limit: 5,    period: 'month' },
  expert:        { type: 'unlimited', limit: null, period: null },
  expert_yearly: { type: 'unlimited', limit: null, period: null },
  unit:          { type: 'total',    limit: 1,    period: null },
}

// Check if org can generate — returns { allowed, reason, used, limit }
export async function checkGenerationQuota(orgId) {
  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('plan, status, gutachten_count, monthly_count, monthly_reset_date, current_period_end')
    .eq('org_id', orgId)
    .single()

  if (!sub || sub.status !== 'active') {
    return { allowed: false, reason: 'no_active_subscription', used: 0, limit: 0 }
  }

  const planConfig = PLAN_LIMITS[sub.plan] || PLAN_LIMITS.none

  if (planConfig.type === 'none') {
    return { allowed: false, reason: 'no_active_subscription', used: 0, limit: 0 }
  }

  if (planConfig.type === 'unlimited') {
    return { allowed: true, reason: null, used: null, limit: null }
  }

  if (planConfig.type === 'total') {
    // unit plan — check total count
    const used = sub.gutachten_count || 0
    if (used >= planConfig.limit) {
      return { allowed: false, reason: 'unit_exhausted', used, limit: planConfig.limit }
    }
    return { allowed: true, reason: null, used, limit: planConfig.limit }
  }

  if (planConfig.type === 'monthly') {
    // Reset monthly count if needed
    const today = new Date().toISOString().split('T')[0]
    const resetDate = sub.monthly_reset_date

    let monthlyCount = sub.monthly_count || 0

    if (!resetDate || resetDate < today.slice(0, 7) + '-01') {
      // New month — reset counter
      await supabaseAdmin
        .from('subscriptions')
        .update({ monthly_count: 0, monthly_reset_date: today })
        .eq('org_id', orgId)
      monthlyCount = 0
    }

    if (monthlyCount >= planConfig.limit) {
      return { allowed: false, reason: 'monthly_limit_reached', used: monthlyCount, limit: planConfig.limit }
    }
    return { allowed: true, reason: null, used: monthlyCount, limit: planConfig.limit }
  }

  return { allowed: false, reason: 'unknown_plan', used: 0, limit: 0 }
}

// Increment quota counter after successful generation
export async function incrementGenerationQuota(orgId) {
  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('plan, gutachten_count, monthly_count')
    .eq('org_id', orgId)
    .single()

  if (!sub) return

  const planConfig = PLAN_LIMITS[sub.plan] || PLAN_LIMITS.none

  if (planConfig.type === 'total') {
    await supabaseAdmin
      .from('subscriptions')
      .update({ gutachten_count: (sub.gutachten_count || 0) + 1 })
      .eq('org_id', orgId)
  } else if (planConfig.type === 'monthly') {
    await supabaseAdmin
      .from('subscriptions')
      .update({ monthly_count: (sub.monthly_count || 0) + 1 })
      .eq('org_id', orgId)
  }
}

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
  let quota = null
  if (planConfig.type === 'monthly') {
    quota = { type: 'monthly', used: sub.monthly_count || 0, limit: planConfig.limit }
  } else if (planConfig.type === 'total') {
    quota = { type: 'total', used: sub.gutachten_count || 0, limit: planConfig.limit }
  } else if (planConfig.type === 'unlimited') {
    quota = { type: 'unlimited', used: null, limit: null }
  }

  res.json({
    plan_name: planNames[sub.plan] || sub.plan,
    status: sub.status,
    current_period_end: sub.current_period_end,
    quota,
  })
})

// GET /api/subscriptions/quota
// Quick quota check for frontend
router.get('/quota', requireAuth, async (req, res) => {
  const { data: member } = await supabaseAdmin
    .from('organization_members')
    .select('org_id')
    .eq('user_id', req.user.id)
    .single()

  if (!member) return res.json({ allowed: false, reason: 'no_org', used: 0, limit: 0 })

  const quota = await checkGenerationQuota(member.org_id)
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