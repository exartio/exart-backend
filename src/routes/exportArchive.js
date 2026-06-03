import express from 'express'
import { supabaseAdmin } from '../lib/supabase.js'
import { requireAuth } from '../middleware/auth.js'
import { Resend } from 'resend'
import archiver from 'archiver'
import { PassThrough } from 'stream'

const router = express.Router()
const resend = new Resend(process.env.RESEND_API_KEY)
const FROM = 'noreply@exart.io'

// POST /api/export-archive/:caseId
// Zips all documents + generated outputs for a case and emails to the requesting user
router.post('/:caseId', requireAuth, async (req, res) => {
  const profile_q = await supabaseAdmin
    .from('profiles')
    .select('id, full_name, org_id')
    .eq('auth_user_id', req.user.id)
    .single()

  const profile = profile_q.data
  if (!profile?.org_id) return res.status(404).json({ error: 'Not found' })

  // Verify case belongs to org
  const { data: caseRow } = await supabaseAdmin
    .from('cases')
    .select(`
      id, title, patient_ref, aktenzeichen,
      case_documents ( id, file_name, storage_path, status, ignored ),
      generated_outputs ( id, version, content_json, output_status, created_at )
    `)
    .eq('id', req.params.caseId)
    .eq('org_id', profile.org_id)
    .single()

  if (!caseRow) return res.status(404).json({ error: 'Case not found' })

  // Get user email
  const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(req.user.id)
  const email = authUser?.user?.email
  if (!email) return res.status(400).json({ error: 'User email not found' })

  // Acknowledge immediately — zipping happens async
  res.json({ message: 'Archiv wird erstellt und an Ihre E-Mail gesendet.', email })

  // Build zip in background
  ;(async () => {
    try {
      console.log(`[ARCHIVE] Building archive for case ${req.params.caseId}`)

      const archive = archiver('zip', { zlib: { level: 6 } })
      const chunks = []
      const passthrough = new PassThrough()
      passthrough.on('data', chunk => chunks.push(chunk))

      archive.pipe(passthrough)

      // Add case documents
      const docs = (caseRow.case_documents || []).filter(d => d.storage_path && !d.ignored && d.status === 'ready')
      for (const doc of docs) {
        try {
          const { data: fileData } = await supabaseAdmin.storage
            .from('case-documents')
            .download(doc.storage_path)
          if (fileData) {
            const buf = Buffer.from(await fileData.arrayBuffer())
            const safeName = doc.file_name.replace(/[^a-zA-Z0-9.\-_äöüÄÖÜß ]/g, '_')
            archive.append(buf, { name: `Dokumente/${safeName}` })
          }
        } catch(e) {
          console.warn(`[ARCHIVE] Could not add doc ${doc.id}:`, e.message)
        }
      }

      // Add generated outputs as TXT files
      const outputs = (caseRow.generated_outputs || []).sort((a, b) => a.version - b.version)
      for (const output of outputs) {
        const text = output.content_json?.text || ''
        if (text) {
          const status = output.output_status === 'completed' ? 'Abgeschlossen' : 'Entwurf'
          const name = `Gutachten/Version_${output.version}_${status}.txt`
          archive.append(Buffer.from(text, 'utf-8'), { name })
        }
      }

      // Add case info summary
      const summary = [
        `Fall: ${caseRow.title}`,
        `Patient/in: ${caseRow.patient_ref || '—'}`,
        `Aktenzeichen: ${caseRow.aktenzeichen || '—'}`,
        `Exportiert: ${new Date().toLocaleString('de-DE')}`,
        `Dokumente: ${docs.length}`,
        `Generierte Versionen: ${outputs.length}`,
      ].join('\n')
      archive.append(Buffer.from(summary, 'utf-8'), { name: 'Fall-Zusammenfassung.txt' })

      await archive.finalize()

      await new Promise(resolve => passthrough.on('end', resolve))
      const zipBuffer = Buffer.concat(chunks)

      console.log(`[ARCHIVE] Zip created: ${zipBuffer.length} bytes, sending to ${email}`)

      const safeCaseTitle = (caseRow.title || 'Fall').replace(/[^a-zA-Z0-9äöüÄÖÜß ]/g, '_')
      const filename = `exart_${safeCaseTitle}_Archiv.zip`

      await resend.emails.send({
        from: FROM,
        to: email,
        subject: `Fallarchiv: ${caseRow.title} — exart.io`,
        attachments: [{ filename, content: zipBuffer.toString('base64') }],
        html: `
<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f7f4ef;font-family:'DM Sans',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f4ef;padding:32px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:6px;overflow:hidden;border:0.5px solid rgba(26,38,64,0.12);">
        <tr><td style="background:#1a2640;padding:24px 32px;">
          <p style="margin:0;font-family:'Playfair Display',Georgia,serif;font-size:20px;font-weight:600;color:#ffffff;">
            exart<span style="color:#b89a5e;font-family:'DM Sans',Arial,sans-serif;font-size:11px;font-weight:500;letter-spacing:0.12em;vertical-align:super;">.io</span>
          </p>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:0.14em;color:#b89a5e;font-weight:500;">Fallarchiv</p>
          <h1 style="margin:0 0 20px;font-family:'Playfair Display',Georgia,serif;font-size:20px;font-weight:500;color:#1a2640;line-height:1.3;">
            Ihr Fallarchiv ist fertig
          </h1>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f4ef;border-radius:5px;margin-bottom:24px;">
            <tr><td style="padding:16px 20px;">
              <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#1a2640;">${caseRow.title}</p>
              <p style="margin:0;font-size:12px;color:#6b7a94;">
                ${docs.length} Dokument${docs.length !== 1 ? 'e' : ''} · ${outputs.length} Gutachtenversion${outputs.length !== 1 ? 'en' : ''}
              </p>
            </td></tr>
          </table>
          <p style="margin:0 0 20px;font-size:14px;color:#4a5568;line-height:1.7;">
            Das Archiv mit allen Dokumenten und Gutachtenversionen für diesen Fall ist als ZIP-Datei beigefügt.
          </p>
          <p style="margin:0;font-size:12px;color:#6b7a94;line-height:1.6;">
            Bei Fragen: <a href="mailto:kontakt@exart.io" style="color:#1a2640;">kontakt@exart.io</a>
          </p>
        </td></tr>
        <tr><td style="background:#f7f4ef;padding:16px 32px;border-top:0.5px solid rgba(26,38,64,0.1);">
          <p style="margin:0;font-size:11px;color:#6b7a94;text-align:center;">exart.io</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
      })

      console.log(`[ARCHIVE] Sent to ${email}`)

    } catch(err) {
      console.error('[ARCHIVE] Failed:', err.message)
    }
  })()
})

export default router