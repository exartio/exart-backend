import express from 'express'
import { supabaseAdmin } from '../lib/supabase.js'
import { sendPsychKGAnfrageNotification } from '../lib/emailService.js'

const router = express.Router()

// POST /api/psychkg-anfrage
// Public — no auth required
// Body: { name, institution, email, telefon?, anmerkungen? }
router.post('/', async (req, res) => {
  const { name, institution, email, telefon, anmerkungen } = req.body

  if (!name?.trim())        return res.status(400).json({ error: 'Name ist erforderlich.' })
  if (!institution?.trim()) return res.status(400).json({ error: 'Institution ist erforderlich.' })
  if (!email?.trim())       return res.status(400).json({ error: 'E-Mail ist erforderlich.' })

  // Basic email format check
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Bitte eine gültige E-Mail-Adresse eingeben.' })
  }

  // Store in DB
  const { data: anfrage, error } = await supabaseAdmin
    .from('psychkg_anfragen')
    .insert({
      name:        name.trim(),
      institution: institution.trim(),
      email:       email.trim().toLowerCase(),
      telefon:     telefon?.trim() || null,
      anmerkungen: anmerkungen?.trim() || null,
    })
    .select()
    .single()

  if (error) {
    console.error('[PSYCHKG-ANFRAGE] DB error:', error.message)
    return res.status(500).json({ error: 'Anfrage konnte nicht gespeichert werden.' })
  }

  // Send admin notification (non-blocking)
  sendPsychKGAnfrageNotification({
    name:        anfrage.name,
    institution: anfrage.institution,
    email:       anfrage.email,
    telefon:     anfrage.telefon,
    anmerkungen: anfrage.anmerkungen,
    created_at:  anfrage.created_at,
    id:          anfrage.id,
  }).catch(err => console.error('[PSYCHKG-ANFRAGE] Email error:', err.message))

  res.status(201).json({ success: true })
})

export default router