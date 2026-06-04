import express from 'express'
import { sendAdminNewUserRegistered, sendAdminEmailConfirmed } from '../lib/emailService.js'

const router = express.Router()

// POST /api/webhooks/auth
// Receives Supabase database webhook events:
//
//   Source 1 — profiles INSERT (new registration)
//     table: "profiles", type: "INSERT"
//     record: { full_name, auth_user_id, ... }
//
//   Source 2 — email_confirmations INSERT (email confirmed)
//     table: "email_confirmations", type: "INSERT"
//     record: { auth_user_id, email, full_name, confirmed_at }
//
// Supabase database webhook payload shape:
//   { type: "INSERT", table: "profiles", record: {...}, schema: "public" }

const WEBHOOK_SECRET = process.env.SUPABASE_WEBHOOK_SECRET

router.post('/', express.json(), async (req, res) => {
  // Verify shared secret
  if (WEBHOOK_SECRET) {
    const incoming = req.headers['x-webhook-secret']
    if (incoming !== WEBHOOK_SECRET) {
      console.warn('[AUTH WEBHOOK] Invalid secret')
      return res.status(401).json({ error: 'Unauthorized' })
    }
  }

  const { type, table, record } = req.body

  if (!type || !record) {
    return res.status(400).json({ error: 'Missing type or record' })
  }

  try {
    if (table === 'profiles' && type === 'INSERT') {
      // New user registered — profile row just created
      // Need to fetch email from auth.users via auth_user_id
      const { supabaseAdmin } = await import('../lib/supabase.js')
      const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(record.auth_user_id)
      const email    = authUser?.user?.email || '—'
      const fullName = record.full_name || '—'

      console.log(`[AUTH WEBHOOK] New registration: ${fullName} <${email}>`)
      await sendAdminNewUserRegistered({ fullName, email })

    } else if (table === 'email_confirmations' && type === 'INSERT') {
      // Email confirmed — inserted by trigger on auth.users
      const fullName = record.full_name || '—'
      const email    = record.email     || '—'

      console.log(`[AUTH WEBHOOK] Email confirmed: ${fullName} <${email}>`)
      await sendAdminEmailConfirmed({ fullName, email })
    }
  } catch (err) {
    console.error('[AUTH WEBHOOK] Notification failed:', err.message)
    // Always acknowledge — never let notification failure block Supabase
  }

  res.json({ received: true })
})

export default router