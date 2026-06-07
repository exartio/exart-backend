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
    ping(`${process.env.SUPABASE_URL}/rest/v1/?apikey=${process.env.SUPABASE_KEY}`, 'Datenbank (Supabase)'),
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

  // ── Error & system health ─────────────────────────────────────────────────
  const { count: docsError } = await supabaseAdmin
    .from('case_documents')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'error')

  const { count: docsProcessing } = await supabaseAdmin
    .from('case_documents')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'processing')

  const { count: docsTotal } = await supabaseAdmin
    .from('case_documents')
    .select('id', { count: 'exact', head: true })
    .neq('status', 'pending')

  const { count: genErrors } = await supabaseAdmin
    .from('audit_log')
    .select('id', { count: 'exact', head: true })
    .eq('action', 'output.generation_error')
    .gte('created_at', month)

  // Check for stale processing docs (stuck > 10 min)
  const tenMinAgo = new Date(now - 10 * 60 * 1000).toISOString()
  const { count: stuckDocs } = await supabaseAdmin
    .from('case_documents')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'processing')
    .lt('created_at', tenMinAgo)

  // ── Funnel / conversion ───────────────────────────────────────────────────
  // Verified but no active subscription (warm leads)
  const { data: verifiedProfiles } = await supabaseAdmin
    .from('profiles')
    .select('org_id')
    .eq('verification_status', 'verified')

  const verifiedOrgIds = verifiedProfiles?.map(p => p.org_id).filter(Boolean) || []
  let verifiedNoSub = 0
  if (verifiedOrgIds.length > 0) {
    const { count: verifiedWithSub } = await supabaseAdmin
      .from('subscriptions')
      .select('id', { count: 'exact', head: true })
      .in('org_id', verifiedOrgIds)
      .eq('status', 'active')
    verifiedNoSub = verifiedOrgIds.length - (verifiedWithSub || 0)
  }

  // Registered but not verified
  const { count: registeredNotVerified } = await supabaseAdmin
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('verification_status', 'pending')

  // Solo users who hit their monthly quota (upgrade signals)
  const { data: soloSubs } = await supabaseAdmin
    .from('subscriptions')
    .select('monthly_count, addon_unit_count')
    .eq('plan', 'solo')
    .eq('status', 'active')

  const quotaExhausted = soloSubs?.filter(s =>
    (s.monthly_count || 0) >= (5 + (s.addon_unit_count || 0))
  ).length || 0

  // ── Usage quality ─────────────────────────────────────────────────────────
  // Avg generations per case
  const { data: caseGenCounts } = await supabaseAdmin
    .from('cases')
    .select('generation_count')
    .gt('generation_count', 0)

  const avgGenPerCase = caseGenCounts?.length > 0
    ? (caseGenCounts.reduce((s, c) => s + (c.generation_count || 0), 0) / caseGenCounts.length).toFixed(1)
    : 0

  // Export rate (exports / real generations)
  const realGens = totalGenerations - (demoGenerations || 0)
  const exportRate = realGens > 0
    ? Math.round((totalExports / realGens) * 100)
    : 0

  // Churn: subscriptions cancelled this month
  let churnCount = 0
  let arrEur = 0
  let soloCount = 0
  let expertCount = 0
  try {
    const cancelled = await stripe.subscriptions.list({
      status: 'canceled',
      created: { gte: Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000) },
      limit: 100,
    })
    churnCount = cancelled.data.length
    arrEur = Math.round(mrr * 12 * 100) / 100
    soloCount = activeSubs.filter(s => s.plan?.includes('solo')).length
    expertCount = activeSubs.filter(s => s.plan?.includes('expert')).length
  } catch(e) { /* stripe already handled */ }

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
    health: {
      docs_error:      docsError || 0,
      docs_processing: docsProcessing || 0,
      docs_total:      docsTotal || 0,
      stuck_docs:      stuckDocs || 0,
      gen_errors_month: genErrors || 0,
      ocr_error_rate:  docsTotal > 0 ? Math.round(((docsError || 0) / docsTotal) * 100) : 0,
    },
    funnel: {
      registered:           totalUsers,
      verified:             verifiedUsers,
      subscribed:           activeSubs.length,
      verified_no_sub:      verifiedNoSub,
      registered_not_verified: registeredNotVerified,
      solo_quota_exhausted: quotaExhausted,
      conversion_reg_to_verified: totalUsers > 0 ? Math.round((verifiedUsers / totalUsers) * 100) : 0,
      conversion_verified_to_sub: verifiedUsers > 0 ? Math.round((activeSubs.length / verifiedUsers) * 100) : 0,
    },
    quality: {
      avg_gen_per_case: avgGenPerCase,
      export_rate_pct:  exportRate,
      churn_month:      churnCount,
      arr_eur:          arrEur,
      solo_count:       soloCount,
      expert_count:     expertCount,
    },
  })
})

// ── GET /api/admin/pending-verifications ────────────────────────────────────
router.get('/pending-verifications', requireAdmin, async (req, res) => {
  const { data: docs, error } = await supabaseAdmin
    .from('verification_documents')
    .select(`
      id, doc_type, storage_path, submitted_at,
      profiles ( id, full_name, auth_user_id, verification_status,
        organizations ( name )
      )
    `)
    .eq('status', 'pending')
    .order('submitted_at', { ascending: true })

  if (error) return res.status(500).json({ error: error.message })

  const docTypeLabels = {
    approbation:     'Approbationsurkunde',
    facharzturkunde: 'Facharztanerkennung',
    berufsausweis:   'EU-Berufsausweis',
    other:           'Sonstiger Nachweis',
  }

  // Generate signed URLs (valid 1 hour) for direct document access
  const result = await Promise.all((docs || []).map(async d => {
    let signed_url = null
    if (d.storage_path) {
      const { data: signed } = await supabaseAdmin.storage
        .from('verification-documents')
        .createSignedUrl(d.storage_path, 3600)
      signed_url = signed?.signedUrl || null
    }
    return {
      id:           d.id,
      doc_type:     docTypeLabels[d.doc_type] || d.doc_type,
      submitted_at: d.submitted_at,
      storage_path: d.storage_path,
      signed_url,
      full_name:    d.profiles?.full_name || '—',
      auth_user_id: d.profiles?.auth_user_id,
      org_name:     d.profiles?.organizations?.name || '—',
      verif_status: d.profiles?.verification_status,
      profile_id:   d.profiles?.id,
    }
  }))

  res.json({ pending: result, count: result.length })
})

// ── POST /api/admin/approve-verification ─────────────────────────────────────
router.post('/approve-verification', requireAdmin, async (req, res) => {
  const { doc_id, auth_user_id } = req.body
  if (!doc_id || !auth_user_id) {
    return res.status(400).json({ error: 'doc_id and auth_user_id required' })
  }

  // Mark verification document as approved
  const { error: docError } = await supabaseAdmin
    .from('verification_documents')
    .update({ status: 'approved' })
    .eq('id', doc_id)
  if (docError) return res.status(500).json({ error: docError.message })

  // Set profile verification_status to verified
  const { error: profileError } = await supabaseAdmin
    .from('profiles')
    .update({ verification_status: 'verified' })
    .eq('auth_user_id', auth_user_id)
  if (profileError) return res.status(500).json({ error: profileError.message })

  // Grant 1 free Gutachten if org has no active plan and not yet granted
  try {
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('org_id')
      .eq('auth_user_id', auth_user_id)
      .single()

    if (profile?.org_id) {
      const { data: sub } = await supabaseAdmin
        .from('subscriptions')
        .select('plan, status, addon_unit_count')
        .eq('org_id', profile.org_id)
        .single()

      const hasNoActivePlan = !sub || sub.status !== 'active' || sub.plan === 'none'
      const notYetGranted   = !sub || (sub.addon_unit_count || 0) === 0

      if (hasNoActivePlan && notYetGranted) {
        await supabaseAdmin
          .from('subscriptions')
          .upsert({ org_id: profile.org_id, plan: 'none', status: 'none', addon_unit_count: 1 }, { onConflict: 'org_id' })
        console.log(`[ADMIN] Free Gutachten granted for org ${profile.org_id}`)
      }
    }
  } catch(grantErr) {
    console.error('[ADMIN] Free Gutachten grant failed:', grantErr.message)
  }

  console.log(`[ADMIN] Verification approved for auth_user_id=${auth_user_id}, doc_id=${doc_id}`)
  res.json({ success: true })
})

export default router