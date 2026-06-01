import express from 'express'
import multer from 'multer'
import { supabaseAdmin } from '../lib/supabase.js'
import { requireAuth } from '../middleware/auth.js'
import { processTemplate } from '../jobs/processTemplate.js'
import { randomUUID } from 'crypto'

const router = express.Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ]
    allowed.includes(file.mimetype)
      ? cb(null, true)
      : cb(new Error('Only PDF and DOCX files are supported'))
  },
})

async function getUserContext(authUserId) {
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('id, org_id')
    .eq('auth_user_id', authUserId)
    .single()
  return data
}

// GET /api/templates
// List all templates for the user's org
router.get('/', requireAuth, async (req, res) => {
  const profile = await getUserContext(req.user.id)
  if (!profile?.org_id) return res.json({ templates: [] })

  const { data: templates, error } = await supabaseAdmin
    .from('templates')
    .select('id, name, description, status, created_at, content_json')
    .eq('org_id', profile.org_id)
    .order('created_at', { ascending: false })

  if (error) throw error
  res.json({ templates })
})

// POST /api/templates/upload
// Upload a new template DOCX or PDF
// Body (multipart): file, name, description?
router.post('/upload', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' })

  const { name, description } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' })

  const profile = await getUserContext(req.user.id)
  if (!profile?.org_id) return res.status(400).json({ error: 'User has no organisation' })

  const ext = req.file.originalname.split('.').pop()
  const storagePath = `${profile.org_id}/${randomUUID()}.${ext}`

  const { error: storageError } = await supabaseAdmin.storage
    .from('templates')
    .upload(storagePath, req.file.buffer, { contentType: req.file.mimetype })

  if (storageError) throw storageError

  const { data: template, error: dbError } = await supabaseAdmin
    .from('templates')
    .insert({
      org_id:      profile.org_id,
      owner_id:    profile.id,
      name:        name.trim(),
      description: description?.trim() || null,
      type:        'custom',
      storage_path: storagePath,
      status:      'pending',
    })
    .select()
    .single()

  if (dbError) throw dbError

  res.status(201).json({ template })

  // Fire and forget
  processTemplate(template.id).catch(err =>
    console.error('[TPL] Unhandled error in processTemplate:', err)
  )
})

// PATCH /api/templates/:id
// Rename or update description
// Body: { name?, description? }
router.patch('/:id', requireAuth, async (req, res) => {
  const profile = await getUserContext(req.user.id)
  if (!profile?.org_id) return res.status(404).json({ error: 'Not found' })

  const { name, description } = req.body
  const updates = {}
  if (name)        updates.name        = name.trim()
  if (description !== undefined) updates.description = description?.trim() || null
  updates.updated_at = new Date().toISOString()

  const { data: template, error } = await supabaseAdmin
    .from('templates')
    .update(updates)
    .eq('id', req.params.id)
    .eq('org_id', profile.org_id)
    .select()
    .single()

  if (error || !template) return res.status(404).json({ error: 'Template not found' })
  res.json({ template })
})

// DELETE /api/templates/:id
router.delete('/:id', requireAuth, async (req, res) => {
  const profile = await getUserContext(req.user.id)
  if (!profile?.org_id) return res.status(404).json({ error: 'Not found' })

  const { data: template } = await supabaseAdmin
    .from('templates')
    .select('id, storage_path')
    .eq('id', req.params.id)
    .eq('org_id', profile.org_id)
    .single()

  if (!template) return res.status(404).json({ error: 'Template not found' })

  if (template.storage_path) {
    await supabaseAdmin.storage
      .from('templates')
      .remove([template.storage_path])
  }

  await supabaseAdmin
    .from('templates')
    .delete()
    .eq('id', template.id)

  res.json({ message: 'Template deleted' })
})

export default router