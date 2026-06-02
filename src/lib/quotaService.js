import { supabaseAdmin } from '../lib/supabase.js'

// Plan limits — now counts cases created, not generations
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
    .select('plan, gutachten_count, monthly_count, addon_unit_count')
    .eq('org_id', orgId)
    .single()

  if (!sub) return

  const planConfig = PLAN_LIMITS[sub.plan] || PLAN_LIMITS.none

  if (planConfig.type === 'total') {
    await supabaseAdmin
      .from('subscriptions')
      .update({ gutachten_count: (sub.gutachten_count || 0) + 1 })
      .eq('org_id', orgId)
    console.log(`[QUOTA] Case created, unit count: ${(sub.gutachten_count || 0) + 1}/${planConfig.limit}`)
  } else if (planConfig.type === 'monthly') {
    const newCount   = (sub.monthly_count || 0) + 1
    const addonUnits = sub.addon_unit_count || 0
    const baseLimit  = planConfig.limit
    const updates    = { monthly_count: newCount }

    if (newCount > baseLimit && addonUnits > 0) {
      updates.addon_unit_count = addonUnits - 1
      console.log(`[QUOTA] Addon unit consumed, ${addonUnits - 1} remaining`)
    }

    await supabaseAdmin
      .from('subscriptions')
      .update(updates)
      .eq('org_id', orgId)
    console.log(`[QUOTA] Case created, monthly count: ${newCount}/${baseLimit + addonUnits}`)
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