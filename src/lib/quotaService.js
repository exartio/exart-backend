import { supabaseAdmin } from '../lib/supabase.js'

// Plan limits configuration
export const PLAN_LIMITS = {
  none:          { type: 'none',      limit: 0,    period: null },
  solo:          { type: 'monthly',   limit: 5,    period: 'month' },
  solo_yearly:   { type: 'monthly',   limit: 5,    period: 'month' },
  expert:        { type: 'unlimited', limit: null, period: null },
  expert_yearly: { type: 'unlimited', limit: null, period: null },
  unit:          { type: 'total',     limit: 1,    period: null },
}

// Check if org can generate — returns { allowed, reason, used, limit }
export async function checkGenerationQuota(orgId) {
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
    // Reset monthly count if we're in a new month
    const today     = new Date()
    const thisMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`
    const resetDate = sub.monthly_reset_date

    let monthlyCount = sub.monthly_count || 0
    const addonUnits = sub.addon_unit_count || 0

    if (!resetDate || resetDate < thisMonth) {
      // New month — reset monthly count but keep addon units
      await supabaseAdmin
        .from('subscriptions')
        .update({ monthly_count: 0, monthly_reset_date: thisMonth })
        .eq('org_id', orgId)
      monthlyCount = 0
    }

    // Effective limit = base limit + addon units purchased
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

// Increment quota counter after successful generation
export async function incrementGenerationQuota(orgId) {
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
    console.log(`[QUOTA] Incremented unit count for org ${orgId}: ${(sub.gutachten_count || 0) + 1}/${planConfig.limit}`)
  } else if (planConfig.type === 'monthly') {
    const newMonthlyCount = (sub.monthly_count || 0) + 1
    const addonUnits      = sub.addon_unit_count || 0
    const baseLimit       = planConfig.limit

    // If this generation uses an addon unit, decrement it
    const updates = { monthly_count: newMonthlyCount }
    if (newMonthlyCount > baseLimit && addonUnits > 0) {
      updates.addon_unit_count = addonUnits - 1
      console.log(`[QUOTA] Addon unit consumed for org ${orgId}, ${addonUnits - 1} remaining`)
    }

    await supabaseAdmin
      .from('subscriptions')
      .update(updates)
      .eq('org_id', orgId)
    console.log(`[QUOTA] Incremented monthly count for org ${orgId}: ${newMonthlyCount}/${baseLimit + addonUnits}`)
  }
}