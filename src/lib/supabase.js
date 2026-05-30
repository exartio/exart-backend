import { createClient } from '@supabase/supabase-js'

// Anon client — respects RLS, use when acting on behalf of a user
export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
)

// Service role client — bypasses RLS
// Use ONLY in trusted server contexts (webhooks, admin ops, audit logging)
export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
)
