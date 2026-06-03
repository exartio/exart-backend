import express from 'express'
import { supabaseAdmin } from '../lib/supabase.js'
import Stripe from 'stripe'

const router = express.Router()
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

// Simple admin key auth — set ADMIN_SECRET in Render env vars
function requireAdmin(req, res, next) {
  const key = req.headers['x-admin-key'] || req.query.key
  if (!key || key !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  next()
}

// ── Helper: run a count query ────────────────────────────────────────────────
async function count(table, filter = {}) {
  let q = supabaseAdmin.from(table).select('id', { count: 'exact', head: true })
  for (const [col, val] of Object.entries(filter)) {
    q = q.eq(col, val)
  }
  const { count: n } = await q
  return n || 0
}

async function countSince(table, col, iso) {
  const { count: n } = await supabaseAdmin
    .from(table)
    .select('id', { count: 'exact', head: true })
    .gte(col, iso)
  return n || 0
}

// ── GET /api/admin/metrics ───────────────────────────────────────────────────
router.get('/metrics', requireAdmin, async (req, res) => {
  const now      = new Date()
  const today    = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
  const week     = new Date(now - 7 * 86400000).toISOString()
  const month    = new Date(now - 30 * 86400000).toISOString()

  // ── Uptime checks ──────────────────────────────────────────────────────────
  async function ping(url, label) {
    const start = Date.now()
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(5000) })
      return { label, url, status: r.ok ? 'up' : 'degraded', code: r.status, ms: Date.now() - start }
    } catch(e) {
      return { label, url, status: 'down', code: 0, ms: Date.now() - start, error: e.message }
    }
  }

  const [backendPing, frontendPing, supabasePing] = await Promise.all([
    ping(`${process.env.RENDER_EXTERNAL_URL || 'https://exart-backend.onrender.com'}/health`, 'Backend (Render)'),
    ping('https://exart.io', 'Frontend (Webflow)'),
    ping(`${process.env.SUPABASE_URL}/rest/v1/`, 'Datenbank (Supabase)'),
  ])

  // ── Users & verification ───────────────────────────────────────────────────
  const [
    totalUsers, verifiedUsers, pendingUsers,
    newUsersToday, newUsersWeek, newUsersMonth,
  ] = await Promise.all([
    count('profiles'),
    count('profiles', { verification_status: 'verified' }),
    count('profiles', { verification_status: 'pending' }),
    countSince('profiles', 'created_at', today),
    countSince('profiles', 'created_at', week),
    countSince('profiles', 'created_at', month),
  ])

  // ── Subscriptions ──────────────────────────────────────────────────────────
  const { data: subs } = await supabaseAdmin
    .from('subscriptions')
    .select('plan, status, created_at')

  const activeSubs = subs?.filter(s => s.status === 'active') || []
  const planCounts = {}
  activeSubs.forEach(s => { planCounts[s.plan] = (planCounts[s.plan] || 0) + 1 })

  const newSubsToday = subs?.filter(s =>
    s.status === 'active' && s.created_at >= today).length || 0
  const newSubsWeek = subs?.filter(s =>
    s.status === 'active' && s.created_at >= week).length || 0

  // ── Usage metrics ──────────────────────────────────────────────────────────
  const [
    totalCases, casesToday, casesWeek,
    totalGenerations, generationsToday, generationsWeek,
    totalExports, exportsToday,
    totalAbrechnungen, totalVorgutachten, totalVorlagen,
  ] = await Promise.all([
    count('cases'),
    countSince('cases', 'created_at', today),
    countSince('cases', 'created_at', week),
    count('generated_outputs'),
    countSince('generated_outputs', 'created_at', today),
    countSince('generated_outputs', 'created_at', week),
    count('exports'),
    countSince('exports', 'created_at', today),
    count('abrechnungen'),
    count('past_statements'),
    count('templates'),
  ])

  // Demo vs real generations
  const { count: demoGenerations } = await supabaseAdmin
    .from('generated_outputs')
    .select('id', { count: 'exact', head: true })
    .eq('is_demo', true)

  // Gutachten types breakdown
  const { data: outputRows } = await supabaseAdmin
    .from('generated_outputs')
    .select('prompt_snapshot')
    .eq('is_demo', false)

  const typeCounts = {}
  outputRows?.forEach(o => {
    const t = o.prompt_snapshot?.gutachten_type || 'betreuung'
    typeCounts[t] = (typeCounts[t] || 0) + 1
  })

  // ── Stripe revenue ────────────────────────────────────────────────────────
  let mrr = 0
  let stripeSubsTotal = 0
  let stripeSubsMonth = 0
  let revenueMonth = 0
  let stripeError = null

  try {
    // Active subscriptions for MRR
    const stripeSubs = await stripe.subscriptions.list({ status: 'active', limit: 100 })
    stripeSubsTotal = stripeSubs.data.length

    mrr = stripeSubs.data.reduce((sum, sub) => {
      const amount = sub.items.data[0]?.price?.unit_amount || 0
      const interval = sub.items.data[0]?.price?.recurring?.interval
      const monthly = interval === 'year' ? amount / 12 : amount
      return sum + monthly
    }, 0) / 100 // cents to euros

    // New subs this month
    const monthStart = Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000)
    const newSubs = await stripe.subscriptions.list({
      created: { gte: monthStart }, limit: 100
    })
    stripeSubsMonth = newSubs.data.length

    // Revenue this month from charges
    const charges = await stripe.charges.list({
      created: { gte: monthStart }, limit: 100
    })
    revenueMonth = charges.data
      .filter(c => c.status === 'succeeded')
      .reduce((sum, c) => sum + c.amount, 0) / 100

  } catch(e) {
    stripeError = e.message
  }

  // ── Referral stats ─────────────────────────────────────────────────────────
  const [totalReferrals, rewardedReferrals] = await Promise.all([
    count('referrals'),
    count('referrals', { status: 'rewarded' }),
  ])

  // ── Assemble response ──────────────────────────────────────────────────────
  res.json({
    timestamp: now.toISOString(),
    uptime: {
      backend:  backendPing,
      frontend: frontendPing,
      database: supabasePing,
    },
    users: {
      total:    totalUsers,
      verified: verifiedUsers,
      pending:  pendingUsers,
      new_today: newUsersToday,
      new_week:  newUsersWeek,
      new_month: newUsersMonth,
    },
    subscriptions: {
      active_total: activeSubs.length,
      by_plan:      planCounts,
      new_today:    newSubsToday,
      new_week:     newSubsWeek,
      stripe_total: stripeSubsTotal,
      stripe_new_month: stripeSubsMonth,
      stripe_error: stripeError,
    },
    revenue: {
      mrr_eur:       Math.round(mrr * 100) / 100,
      month_eur:     Math.round(revenueMonth * 100) / 100,
      stripe_error:  stripeError,
    },
    usage: {
      cases:       { total: totalCases,       today: casesToday,       week: casesWeek },
      generations: { total: totalGenerations, today: generationsToday, week: generationsWeek,
                     demo: demoGenerations || 0, real: (totalGenerations - (demoGenerations || 0)) },
      exports:     { total: totalExports, today: exportsToday },
      abrechnungen: totalAbrechnungen,
      vorgutachten: totalVorgutachten,
      vorlagen:     totalVorlagen,
      by_type:      typeCounts,
    },
    referrals: {
      total:    totalReferrals,
      rewarded: rewardedReferrals,
    },
  })
})

export default router