import express from 'express'
import { supabaseAdmin } from '../lib/supabase.js'
import { requireAuth } from '../middleware/auth.js'

const router = express.Router()

async function requireAdmin(userId) {
  const { data } = await supabaseAdmin
    .from('organization_members')
    .select('org_id, role')
    .eq('user_id', userId)
    .single()
  if (!data || !['owner', 'admin'].includes(data.role)) return null
  return data
}


// GET /api/verification/pending
// List pending verification docs for the org (admins only)
router.get('/pending', requireAuth, async (req, res) => {
  const member = await requireAdmin(req.user.id)
  if (!member) return res.status(403).json({ error: 'Admin access required' })

  const { data: docs, error } = await supabaseAdmin
    .from('verification_documents')
    .select(`
      id, doc_type, status, submitted_at,
      profiles ( id, full_name, title, verification_status )
    `)
    .eq('org_id', member.org_id)
    .eq('status', 'pending')
    .order('submitted_at', { ascending: true })

  if (error) throw error
  res.json({ documents: docs })
})


// GET /api/verification/signed-url/:docId
// Get a signed URL to view a verification document (admins only)
router.get('/signed-url/:docId', requireAuth, async (req, res) => {
  const member = await requireAdmin(req.user.id)
  if (!member) return res.status(403).json({ error: 'Admin access required' })

  const { data: doc } = await supabaseAdmin
    .from('verification_documents')
    .select('storage_path')
    .eq('id', req.params.docId)
    .eq('org_id', member.org_id)
    .single()

  if (!doc) return res.status(404).json({ error: 'Document not found' })

  const { data: signedUrl } = await supabaseAdmin.storage
    .from('verification-documents')
    .createSignedUrl(doc.storage_path, 3600)

  res.json({ url: signedUrl.signedUrl })
})


// POST /api/verification/:docId/approve
// Approve a verification document — triggers profile + org unlock via DB triggers
router.post('/:docId/approve', requireAuth, async (req, res) => {
  const member = await requireAdmin(req.user.id)
  if (!member) return res.status(403).json({ error: 'Admin access required' })

  const { data: doc } = await supabaseAdmin
    .from('verification_documents')
    .select('id')
    .eq('id', req.params.docId)
    .eq('org_id', member.org_id)
    .single()

  if (!doc) return res.status(404).json({ error: 'Document not found' })

  const { error } = await supabaseAdmin
    .from('verification_documents')
    .update({
      status: 'approved',
      reviewed_by: req.user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', doc.id)

  if (error) throw error

  await supabaseAdmin.from('audit_log').insert({
    org_id: member.org_id,
    user_id: req.user.id,
    action: 'verification.approved',
    entity_type: 'verification_documents',
    entity_id: doc.id,
  })

  res.json({ message: 'Approved. Physician verification unlocked.' })
})


// POST /api/verification/:docId/reject
// Reject a verification document with an optional note
// Body: { note? }
router.post('/:docId/reject', requireAuth, async (req, res) => {
  const { note } = req.body
  const member = await requireAdmin(req.user.id)
  if (!member) return res.status(403).json({ error: 'Admin access required' })

  const { data: doc } = await supabaseAdmin
    .from('verification_documents')
    .select('id')
    .eq('id', req.params.docId)
    .eq('org_id', member.org_id)
    .single()

  if (!doc) return res.status(404).json({ error: 'Document not found' })

  const { error } = await supabaseAdmin
    .from('verification_documents')
    .update({
      status: 'rejected',
      rejection_note: note || null,
      reviewed_by: req.user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', doc.id)

  if (error) throw error

  await supabaseAdmin.from('audit_log').insert({
    org_id: member.org_id,
    user_id: req.user.id,
    action: 'verification.rejected',
    entity_type: 'verification_documents',
    entity_id: doc.id,
    metadata: { note },
  })

  res.json({ message: 'Document rejected.' })
})

export default router
