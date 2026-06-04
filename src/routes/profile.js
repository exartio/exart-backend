import express from 'express'
import { supabaseAdmin } from '../lib/supabase.js'
import { requireAuth } from '../middleware/auth.js'
import { sendAdminAccountDeleted } from '../lib/emailService.js'

const router = express.Router()

// GET /api/profile
// Returns the current user's profile
router.get('/', requireAuth, async (req, res) => {
  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('auth_user_id', req.user.id)
    .single()

  if (error || !profile) {
    return res.status(404).json({ error: 'Profile not found' })
  }

  res.json(profile)
})

// PATCH /api/profile
// Updates the current user's profile
// Body: { full_name, title }
router.patch('/', requireAuth, async (req, res) => {
  const { full_name, title } = req.body

  const updates = {}
  if (full_name !== undefined) updates.full_name = full_name
  if (title !== undefined) updates.title = title
  updates.updated_at = new Date().toISOString()

  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .update(updates)
    .eq('auth_user_id', req.user.id)
    .select()
    .single()

  if (error) {
    return res.status(500).json({ error: error.message })
  }

  res.json(profile)
})

// DELETE /api/account
// Deletes the current user's account and all associated data
router.delete('/account', requireAuth, async (req, res) => {
  const userId = req.user.id

  // Fetch name + email before deleting for admin notification
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('full_name')
    .eq('auth_user_id', userId)
    .single()
  const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId)
  const email    = authUser?.user?.email || '—'
  const fullName = profile?.full_name || '—'

  // Delete profile (cascades to cases, documents via FK)
  await supabaseAdmin
    .from('profiles')
    .delete()
    .eq('auth_user_id', userId)

  // Delete auth user
  const { error } = await supabaseAdmin.auth.admin.deleteUser(userId)
  if (error) {
    return res.status(500).json({ error: error.message })
  }

  // Notify admin
  sendAdminAccountDeleted({ fullName, email }).catch(err =>
    console.error('[EMAIL] Admin account-deleted notification failed:', err.message)
  )

  res.json({ message: 'Account deleted' })
})

export default router