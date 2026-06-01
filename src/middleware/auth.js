import { supabase, supabaseAdmin } from '../lib/supabase.js'

// Validates Supabase JWT and attaches req.user
export async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization header' })
  }
  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
  req.user = user
  req.token = token
  next()
}

// Checks org access level and attaches req.accessLevel
// 'none' | 'demo' | 'full'
export async function checkAccess(req, res, next) {
  try {
    const { data, error } = await supabaseAdmin
      .rpc('check_org_access', { p_user_id: req.user.id })

    if (error) {
      // RPC error — default to 'none' and continue rather than crashing
      console.error(`[ACCESS] check_org_access error for user ${req.user.id}:`, error.message)
      req.accessLevel = 'none'
      return next()
    }

    req.accessLevel = data || 'none'
    next()
  } catch (err) {
    // Unexpected error (e.g. Supabase timeout) — fail gracefully
    console.error(`[ACCESS] Unexpected error in checkAccess:`, err.message)
    req.accessLevel = 'none'
    next()
  }
}

// Blocks requests from users without full access
// Use on all AI processing routes
export function requireFullAccess(req, res, next) {
  if (req.accessLevel !== 'full') {
    return res.status(403).json({
      error: 'Full access required',
      reason: req.accessLevel === 'demo'
        ? 'pending_physician_verification'
        : 'no_active_subscription',
      accessLevel: req.accessLevel,
    })
  }
  next()
}