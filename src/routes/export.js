import express from 'express'
import { supabaseAdmin } from '../lib/supabase.js'
import { requireAuth, checkAccess, requireFullAccess } from '../middleware/auth.js'
import { randomUUID } from 'crypto'
import PDFDocument from 'pdfkit'

const router = express.Router()

async function getUserContext(authUserId) {
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('id, org_id')
    .eq('auth_user_id', authUserId)
    .single()
  return data
}


// POST /api/export
// Generate a PDF or DOCX from a generated output
// Body: { output_id, format: 'pdf' | 'docx' }
router.post('/', requireAuth, checkAccess, requireFullAccess, async (req, res) => {
  const { output_id, format } = req.body

  if (!output_id) return res.status(400).json({ error: 'output_id is required' })
  if (!['pdf', 'docx'].includes(format)) {
    return res.status(400).json({ error: 'format must be pdf or docx' })
  }

  const profile = await getUserContext(req.user.id)
  if (!profile?.org_id) return res.status(400).json({ error: 'No organisation found' })

  const { data: output, error: outputError } = await supabaseAdmin
    .from('generated_outputs')
    .select(`
      id, content_json, is_demo, version,
      cases ( id, patient_ref, title, org_id )
    `)
    .eq('id', output_id)
    .eq('org_id', profile.org_id)
    .single()

  if (outputError || !output) {
    return res.status(404).json({ error: 'Output not found' })
  }

  if (output.is_demo) {
    return res.status(403).json({ error: 'Cannot export demo outputs' })
  }

  const text = output.content_json?.text || ''
  const caseId = output.cases?.id
  const filename = `gutachten_${output.cases?.patient_ref}_v${output.version}`

  try {
    let fileBuffer
    let contentType

    if (format === 'docx') {
      fileBuffer = await generateDocx(text, output.cases)
      contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    } else {
      fileBuffer = await generatePdf(text, output.cases)
      contentType = 'application/pdf'
    }

    const storagePath = `${profile.org_id}/${caseId}/${output_id}/${randomUUID()}.${format}`

    const { error: uploadError } = await supabaseAdmin.storage
      .from('exports')
      .upload(storagePath, fileBuffer, { contentType, upsert: false })

    if (uploadError) throw uploadError

    const { data: exportRecord } = await supabaseAdmin
      .from('exports')
      .insert({
        output_id,
        org_id: profile.org_id,
        created_by: profile.id,
        format,
        storage_path: storagePath,
      })
      .select('id')
      .single()

    const { data: signedUrl } = await supabaseAdmin.storage
      .from('exports')
      .createSignedUrl(storagePath, 3600)

    await supabaseAdmin.from('audit_log').insert({
      org_id: profile.org_id,
      user_id: req.user.id,
      action: 'output.exported',
      entity_type: 'exports',
      entity_id: exportRecord.id,
      metadata: { format, output_id },
    })

    res.json({
      export_id: exportRecord.id,
      filename: `${filename}.${format}`,
      url: signedUrl.signedUrl,
      expires_in: 3600,
    })

  } catch (err) {
    console.error('[EXPORT] Failed:', err.message)
    res.status(500).json({ error: 'Export failed', message: err.message })
  }
})


// ── DOCX generation ───────────────────────────────────────────────
async function generateDocx(text, caseData) {
  const { Document, Paragraph, TextRun, HeadingLevel, Packer, AlignmentType } =
    await import('docx')

  const paragraphs = []

  paragraphs.push(
    new Paragraph({
      text: 'Betreuungsgutachten',
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
    })
  )

  paragraphs.push(
    new Paragraph({
      children: [
        new TextRun({ text: 'Referenz: ', bold: true }),
        new TextRun({ text: caseData?.patient_ref || '' }),
      ],
      spacing: { after: 200 },
    })
  )

  const lines = text.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('## ')) {
      paragraphs.push(new Paragraph({
        text: trimmed.replace(/^## /, ''),
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 200 },
      }))
    } else if (trimmed.startsWith('### ')) {
      paragraphs.push(new Paragraph({
        text: trimmed.replace(/^### /, ''),
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 300, after: 160 },
      }))
    } else if (trimmed.startsWith('**') && trimmed.endsWith('**')) {
      paragraphs.push(new Paragraph({
        children: [new TextRun({ text: trimmed.replace(/\*\*/g, ''), bold: true })],
        spacing: { after: 120 },
      }))
    } else if (trimmed === '') {
      paragraphs.push(new Paragraph({ text: '', spacing: { after: 120 } }))
    } else {
      paragraphs.push(new Paragraph({ text: trimmed, spacing: { after: 120 } }))
    }
  }

  const doc = new Document({
    creator: 'exart.io',
    title: 'Betreuungsgutachten',
    sections: [{
      properties: {
        page: {
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1800 },
        },
      },
      children: paragraphs,
    }],
  })

  return await Packer.toBuffer(doc)
}


// ── PDF generation via pdfkit ────────────────────────────────────
async function generatePdf(text, caseData) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 72, bottom: 72, left: 85, right: 72 },
      info: {
        Title: 'Betreuungsgutachten',
        Author: 'exart.io',
      },
    })

    const chunks = []
    doc.on('data', chunk => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    // Title
    doc
      .fontSize(18)
      .font('Helvetica-Bold')
      .text('Betreuungsgutachten', { align: 'center' })
      .moveDown(0.5)

    // Patient ref line
    doc
      .fontSize(10)
      .font('Helvetica')
      .fillColor('#333333')
      .text(`Referenz: ${caseData?.patient_ref || ''} | ${caseData?.title || ''}`, { align: 'left' })
      .moveDown(1)

    // Divider line
    doc
      .moveTo(doc.page.margins.left, doc.y)
      .lineTo(doc.page.width - doc.page.margins.right, doc.y)
      .strokeColor('#000000')
      .lineWidth(0.5)
      .stroke()
      .moveDown(1)

    // Body text
    const lines = text.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()

      if (trimmed.startsWith('## ')) {
        doc
          .moveDown(0.5)
          .fontSize(13)
          .font('Helvetica-Bold')
          .fillColor('#000000')
          .text(trimmed.replace(/^## /, ''))
          .moveDown(0.3)
        // Underline
        doc
          .moveTo(doc.page.margins.left, doc.y)
          .lineTo(doc.page.width - doc.page.margins.right, doc.y)
          .strokeColor('#000000')
          .lineWidth(0.3)
          .stroke()
          .moveDown(0.4)
      } else if (trimmed.startsWith('### ')) {
        doc
          .moveDown(0.4)
          .fontSize(11)
          .font('Helvetica-Bold')
          .fillColor('#000000')
          .text(trimmed.replace(/^### /, ''))
          .moveDown(0.3)
      } else if (trimmed === '') {
        doc.moveDown(0.4)
      } else {
        // Handle inline bold **text**
        const parts = trimmed.split(/(\*\*.*?\*\*)/)
        if (parts.length > 1) {
          doc.fontSize(11).fillColor('#000000')
          let x = doc.page.margins.left
          const y = doc.y
          for (const part of parts) {
            if (part.startsWith('**') && part.endsWith('**')) {
              doc.font('Helvetica-Bold').text(part.slice(2, -2), { continued: true })
            } else if (part) {
              doc.font('Helvetica').text(part, { continued: true })
            }
          }
          doc.text('') // end continued line
          doc.moveDown(0.3)
        } else {
          doc
            .fontSize(11)
            .font('Helvetica')
            .fillColor('#000000')
            .text(trimmed, { align: 'justify' })
            .moveDown(0.3)
        }
      }
    }

    doc.end()
  })
}

export default router