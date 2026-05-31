import express from 'express'
import { supabaseAdmin } from '../lib/supabase.js'
import { requireAuth } from '../middleware/auth.js'
import Stripe from 'stripe'

const router = express.Router()
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

// GET /api/subscriptions/me
// Returns the current user's subscription
router.get('/me', requireAuth, async (req, res) => {
  const { data: member } = await supabaseAdmin
    .from('organization_members')
    .select('org_id')
    .eq('user_id', req.user.id)
    .single()

  if (!member) {
    return res.json({ plan_name: null, status: 'none', current_period_end: null })
  }

  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('*')
    .eq('org_id', member.org_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (!sub) {
    return res.json({ plan_name: null, status: 'none', current_period_end: null })
  }

  // Map plan slug to display name
  const planNames = {
    einzelfall:     'Einzelfall',
    niedergelassen: 'Niedergelassen',
    sachverstaendiger: 'Sachverständiger',
    institution:    'Institution',
  }

  res.json({
    plan_name: planNames[sub.plan] || sub.plan,
    status: sub.status,
    current_period_end: sub.current_period_end,
  })
})

// POST /api/subscriptions/portal
// Creates a Stripe customer portal session
router.post('/portal', requireAuth, async (req, res) => {
  const { data: member } = await supabaseAdmin
    .from('organization_members')
    .select('org_id')
    .eq('user_id', req.user.id)
    .single()

  if (!member) {
    return res.status(404).json({ error: 'No organisation found' })
  }

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
