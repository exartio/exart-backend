import express from 'express'
import { stripe, PLANS } from '../lib/stripeClient.js'
import { supabaseAdmin } from '../lib/supabase.js'
import { requireAuth } from '../middleware/auth.js'

const router = express.Router()

// POST /api/stripe/checkout
// Creates a Stripe Checkout session for the user's org
// Body: { plan: 'solo' | 'expert' | 'einzelgutachten' }
router.post('/checkout', requireAuth, async (req, res) => {
  const { plan } = req.body

  if (!PLANS[plan]) {
    return res.status(400).json({ error: 'Invalid plan' })
  }

  const { data: member, error: memberError } = await supabaseAdmin
    .from('organization_members')
    .select('org_id, organizations(name)')
    .eq('user_id', req.user.id)
    .single()

  if (memberError || !member) {
    return res.status(400).json({ error: 'User has no organisation' })
  }

  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('org_id', member.org_id)
    .single()

  let customerId = sub?.stripe_customer_id

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: req.user.email,
      name: member.organizations.name,
      metadata: { supabase_org_id: member.org_id },
    })
    customerId = customer.id

    await supabaseAdmin
      .from('subscriptions')
      .update({ stripe_customer_id: customerId })
      .eq('org_id', member.org_id)
  }

  const planConfig = PLANS[plan]
  const isOneTime = planConfig.type === 'one_time'

  // Payment methods:
  // - card: always available
  // - paypal: supported for both subscription and one-time in DE
  // - klarna: only for one-time payments (does not support subscriptions)
  const paymentMethods = isOneTime
    ? ['card', 'paypal', 'klarna']
    : ['card', 'paypal']

  const sessionParams = {
    customer: customerId,
    line_items: [{ price: planConfig.priceId, quantity: 1 }],
    mode: isOneTime ? 'payment' : 'subscription',
    payment_method_types: paymentMethods,
    success_url: `${process.env.FRONTEND_URL}/dashboard?subscribed=true`,
    cancel_url: `${process.env.FRONTEND_URL}/#preise`,
    metadata: { supabase_org_id: member.org_id, plan },
    locale: 'de',
  }

  // Klarna requires billing address collection
  if (isOneTime) {
    sessionParams.billing_address_collection = 'required'
  }

  const session = await stripe.checkout.sessions.create(sessionParams)

  res.json({ url: session.url })
})


// POST /api/stripe/portal
// Opens the Stripe customer portal for self-service billing
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
    return res.status(400).json({ error: 'No Stripe customer found' })
  }

  const portalSession = await stripe.billingPortal.sessions.create({
    customer: sub.stripe_customer_id,
    return_url: `${process.env.FRONTEND_URL}/dashboard-settings`,
  })

  res.json({ url: portalSession.url })
})


// POST /api/stripe/webhook
// Handles Stripe events — registered before express.json() in index.js
router.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const sig = req.headers['stripe-signature']
    let event

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      )
    } catch (err) {
      console.error('Webhook signature failed:', err.message)
      return res.status(400).json({ error: `Webhook error: ${err.message}` })
    }

    try {
      await handleStripeEvent(event)
      res.json({ received: true })
    } catch (err) {
      console.error('Webhook handler error:', err)
      res.status(500).json({ error: 'Webhook processing failed' })
    }
  }
)

async function handleStripeEvent(event) {
  switch (event.type) {

    // Recurring subscription activated
    case 'checkout.session.completed': {
      const session = event.data.object
      const orgId = session.metadata?.supabase_org_id
      const plan = session.metadata?.plan
      if (!orgId) break

      if (session.mode === 'subscription') {
        const subscription = await stripe.subscriptions.retrieve(session.subscription)
        await supabaseAdmin
          .from('subscriptions')
          .update({
            stripe_subscription_id: subscription.id,
            stripe_customer_id: session.customer,
            plan: plan || 'solo',
            status: subscription.status,
            verified_seat_limit: PLANS[plan]?.verifiedSeatLimit || 1,
            current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
          })
          .eq('org_id', orgId)
        await auditLog(orgId, null, 'subscription.activated', 'subscriptions', null, { plan })
      } else if (session.mode === 'payment') {
        // One-time unit purchase — never expires
        const { data: existingSub } = await supabaseAdmin
          .from('subscriptions')
          .select('plan, status, addon_unit_count')
          .eq('org_id', orgId)
          .single()

        if (existingSub?.status === 'active' && existingSub.plan !== 'none' && existingSub.plan !== 'unit') {
          // Existing active subscription — add as addon unit (no expiry)
          await supabaseAdmin
            .from('subscriptions')
            .update({
              stripe_customer_id: session.customer,
              addon_unit_count: (existingSub.addon_unit_count || 0) + 1,
            })
            .eq('org_id', orgId)
          await auditLog(orgId, null, 'subscription.addon_unit_added', 'subscriptions', null, { plan })
        } else {
          // No active subscription — standalone unit purchase, no expiry
          await supabaseAdmin
            .from('subscriptions')
            .update({
              stripe_customer_id: session.customer,
              plan: 'unit',
              status: 'active',
              gutachten_count: 0,
              current_period_end: null,
            })
            .eq('org_id', orgId)
          await auditLog(orgId, null, 'subscription.unit_purchased', 'subscriptions', null, { plan })
        }
      }
      break
    }

    case 'customer.subscription.updated': {
      const subscription = event.data.object
      const orgId = await getOrgByCustomer(subscription.customer)
      if (!orgId) break

      await supabaseAdmin
        .from('subscriptions')
        .update({
          status: subscription.status,
          current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
        })
        .eq('org_id', orgId)
      break
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object
      const orgId = await getOrgByCustomer(subscription.customer)
      if (!orgId) break

      await supabaseAdmin
        .from('subscriptions')
        .update({ status: 'canceled', plan: 'none' })
        .eq('org_id', orgId)

      await auditLog(orgId, null, 'subscription.canceled', 'subscriptions', null, {})
      break
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object
      const orgId = await getOrgByCustomer(invoice.customer)
      if (!orgId) break

      await supabaseAdmin
        .from('subscriptions')
        .update({ status: 'past_due' })
        .eq('org_id', orgId)
      break
    }

    default:
      break
  }
}

async function getOrgByCustomer(customerId) {
  const { data } = await supabaseAdmin
    .from('subscriptions')
    .select('org_id')
    .eq('stripe_customer_id', customerId)
    .single()
  return data?.org_id || null
}

async function auditLog(orgId, userId, action, entityType, entityId, metadata) {
  await supabaseAdmin.from('audit_log').insert({
    org_id: orgId,
    user_id: userId,
    action,
    entity_type: entityType,
    entity_id: entityId,
    metadata,
  })
}

export default router