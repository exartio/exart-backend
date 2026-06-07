import { supabaseAdmin } from '../lib/supabase.js'

// Plan limits — counts cases created, not generations
export const PLAN_LIMITS = {
  none:          { type: 'none',      limit: 0,    period: null },
  solo:          { type: 'monthly',   limit: 5,    period: 'month' },
  solo_yearly:   { type: 'monthly',   limit: 5,    period: 'month' },
  expert:        { type: 'unlimited', limit: null, period: null },
  expert_yearly: { type: 'unlimited', limit: null, period: null },
  unit:          { type: 'total',     limit: 1,    period: null },
}

// Check if org can create a new case
// Returns { allowed, reason, used, limit }
export async function checkCaseCreationQuota(orgId) {
  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('plan, status, gutachten_count, monthly_count, monthly_reset_date, addon_unit_count')
    .eq('org_id', orgId)
    .single()

  const planConfig = PLAN_LIMITS[sub?.plan] || PLAN_LIMITS.none

  // For plan 'none', inactive, or missing sub: allow if addon units exist
  // (e.g. free Gutachten granted on verification)
  if (!sub || sub.status !== 'active' || planConfig.type === 'none') {
    const addonUnits = sub?.addon_unit_count || 0
    if (addonUnits > 0) {
      return { allowed: true, reason: null, used: 0, limit: addonUnits, addon_units: addonUnits }
    }
    return { allowed: false, reason: 'no_active_subscription', used: 0, limit: 0 }
  }

  if (planConfig.type === 'unlimited') {
    return { allowed: true, reason: null, used: null, limit: null }
  }

  if (planConfig.type === 'total') {
    const used = sub.gutachten_count || 0
    if (used >= planConfig.limit) {
      return { allowed: false, reason: 'unit_exhausted', used, limit: planConfig.limit }
    }
    return { allowed: true, reason: null, used, limit: planConfig.limit }
  }

  if (planConfig.type === 'monthly') {
    const today     = new Date()
    const thisMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`
    const resetDate = sub.monthly_reset_date
    const addonUnits = sub.addon_unit_count || 0

    let monthlyCount = sub.monthly_count || 0

    if (!resetDate || resetDate < thisMonth) {
      await supabaseAdmin
        .from('subscriptions')
        .update({ monthly_count: 0, monthly_reset_date: thisMonth })
        .eq('org_id', orgId)
      monthlyCount = 0
    }

    const effectiveLimit = planConfig.limit + addonUnits

    if (monthlyCount >= effectiveLimit) {
      return {
        allowed: false,
        reason: 'monthly_limit_reached',
        used: monthlyCount,
        limit: effectiveLimit,
        base_limit: planConfig.limit,
        addon_units: addonUnits,
      }
    }
    return {
      allowed: true,
      reason: null,
      used: monthlyCount,
      limit: effectiveLimit,
      base_limit: planConfig.limit,
      addon_units: addonUnits,
    }
  }

  return { allowed: false, reason: 'unknown_plan', used: 0, limit: 0 }
}

// Increment case creation counter after new case is created
export async function incrementCaseCreationQuota(orgId) {
  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('plan, status, gutachten_count, monthly_count, addon_unit_count')
    .eq('org_id', orgId)
    .single()

  if (!sub) return

  const planConfig = PLAN_LIMITS[sub.plan] || PLAN_LIMITS.none

  if (planConfig.type === 'none' || sub.status !== 'active') {
    // Decrement addon unit if present (e.g. free Gutachten granted on verification)
    const addonUnits = sub.addon_unit_count || 0
    if (addonUnits > 0) {
      await supabaseAdmin
        .from('subscriptions')
        .update({ addon_unit_count: addonUnits - 1 })
        .eq('org_id', orgId)
      console.log(`[QUOTA] Free addon unit consumed for org ${orgId}, remaining: ${addonUnits - 1}`)
    }
    return
  }

  if (planConfig.type === 'total') {
    await supabaseAdmin
      .from('subscriptions')
      .update({ gutachten_count: (sub.gutachten_count || 0) + 1 })
      .eq('org_id', orgId)
    console.log(`[QUOTA] Case created, unit count: ${(sub.gutachten_count || 0) + 1}/${planConfig.limit}`)
  } else if (planConfig.type === 'monthly') {
    // Always increment monthly_count only.
    // addon_unit_count is set at purchase time by the Stripe webhook and
    // must NOT be decremented here — it resets with the subscription cycle.
    const newCount = (sub.monthly_count || 0) + 1
    await supabaseAdmin
      .from('subscriptions')
      .update({ monthly_count: newCount })
      .eq('org_id', orgId)
    console.log(`[QUOTA] Case created, monthly count: ${newCount}`)
  }
}

// Check if a case can generate another gutachten
// Returns { allowed, reason, count, max }
export async function checkGenerationQuota(caseId) {
  const { data: caseRow } = await supabaseAdmin
    .from('cases')
    .select('generation_count, max_generations')
    .eq('id', caseId)
    .single()

  if (!caseRow) return { allowed: false, reason: 'case_not_found', count: 0, max: 3 }

  const count = caseRow.generation_count || 0
  const max   = caseRow.max_generations || 3

  if (count >= max) {
    return { allowed: false, reason: 'generation_limit_reached', count, max }
  }

  return { allowed: true, reason: null, count, max }
}

// Increment generation counter on a case after successful generation
export async function incrementGenerationQuota(caseId) {
  const { data: caseRow } = await supabaseAdmin
    .from('cases')
    .select('generation_count')
    .eq('id', caseId)
    .single()

  if (!caseRow) return

  const newCount = (caseRow.generation_count || 0) + 1
  await supabaseAdmin
    .from('cases')
    .update({ generation_count: newCount })
    .eq('id', caseId)

  console.log(`[QUOTA] Generation ${newCount} for case ${caseId}`)
}

// ── OCR document limits per case ─────────────────────────────────────────────

export const OCR_LIMITS = {
  solo:          { case_document: 20, expert_finding: 20 },
  solo_yearly:   { case_document: 20, expert_finding: 20 },
  expert:        { case_document: 50, expert_finding: 50 },
  expert_yearly: { case_document: 50, expert_finding: 50 },
  unit:          { case_document: 20, expert_finding: 20 },
  none:          { case_document:  5, expert_finding:  5 },
}

// Check if an org can OCR-process another document for a given case
// type: 'case_document' | 'expert_finding'
// Returns { allowed, used, limit }
export async function checkOcrQuota(orgId, caseId, type) {
  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('plan')
    .eq('org_id', orgId)
    .single()

  const plan   = sub?.plan || 'none'
  const limits = OCR_LIMITS[plan] || OCR_LIMITS.none
  const limit  = limits[type] ?? 0

  const col = type === 'case_document' ? 'ocr_case_doc_count' : 'ocr_expert_finding_count'

  const { data: caseRow } = await supabaseAdmin
    .from('cases')
    .select(col)
    .eq('id', caseId)
    .single()

  const used = caseRow?.[col] || 0

  if (used >= limit) {
    return { allowed: false, used, limit }
  }
  return { allowed: true, used, limit }
}

// Increment the OCR counter on the case after a document is queued for processing
// type: 'case_document' | 'expert_finding'
export async function incrementOcrCount(caseId, type) {
  const col = type === 'case_document' ? 'ocr_case_doc_count' : 'ocr_expert_finding_count'

  const { data: caseRow } = await supabaseAdmin
    .from('cases')
    .select(col)
    .eq('id', caseId)
    .single()

  if (!caseRow) return

  await supabaseAdmin
    .from('cases')
    .update({ [col]: (caseRow[col] || 0) + 1 })
    .eq('id', caseId)

  console.log(`[OCR] ${type} count incremented for case ${caseId}: ${(caseRow[col] || 0) + 1}`)
}