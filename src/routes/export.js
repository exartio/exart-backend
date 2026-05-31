import express from 'express'
import { supabaseAdmin } from '../lib/supabase.js'
import { requireAuth, checkAccess, requireFullAccess } from '../middleware/auth.js'
import { randomUUID } from 'crypto'

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

  // Load the output
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

    // Upload to Supabase Storage
    const storagePath = `${profile.org_id}/${caseId}/${output_id}/${randomUUID()}.${format}`

    const { error: uploadError } = await supabaseAdmin.storage
      .from('exports')
      .upload(storagePath, fileBuffer, { contentType, upsert: false })

    if (uploadError) throw uploadError

    // Save export record
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

    // Generate signed download URL (1 hour)
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

  // Title
  paragraphs.push(
    new Paragraph({
      text: 'Betreuungsgutachten',
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
    })
  )

  // Patient ref
  paragraphs.push(
    new Paragraph({
      children: [
        new TextRun({ text: 'Referenz: ', bold: true }),
        new TextRun({ text: caseData?.patient_ref || '' }),
      ],
      spacing: { after: 200 },
    })
  )

  // Parse the generated text into paragraphs
  // Markdown-style headings (## Heading) become Word headings
  const lines = text.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()

    if (trimmed.startsWith('## ')) {
      paragraphs.push(
        new Paragraph({
          text: trimmed.replace(/^## /, ''),
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 400, after: 200 },
        })
      )
    } else if (trimmed.startsWith('### ')) {
      paragraphs.push(
        new Paragraph({
          text: trimmed.replace(/^### /, ''),
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 300, after: 160 },
        })
      )
    } else if (trimmed.startsWith('**') && trimmed.endsWith('**')) {
      paragraphs.push(
        new Paragraph({
          children: [new TextRun({ text: trimmed.replace(/\*\*/g, ''), bold: true })],
          spacing: { after: 120 },
        })
      )
    } else if (trimmed === '') {
      paragraphs.push(new Paragraph({ text: '', spacing: { after: 120 } }))
    } else {
      paragraphs.push(
        new Paragraph({
          text: trimmed,
          spacing: { after: 120 },
        })
      )
    }
  }

  const doc = new Document({
    creator: 'exart.io',
    title: 'Betreuungsgutachten',
    sections: [{
      properties: {
        page: {
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1800 }, // DIN A4 margins
        },
      },
      children: paragraphs,
    }],
  })

  return await Packer.toBuffer(doc)
}


// ── PDF generation ────────────────────────────────────────────────
async function generatePdf(text, caseData) {
  // Dynamic import — puppeteer is heavy, only load when needed
  const puppeteer = await import('puppeteer')
  const browser = await puppeteer.default.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })

  const page = await browser.newPage()

  // Convert markdown-like text to basic HTML
  const html = textToHtml(text, caseData)
  await page.setContent(html, { waitUntil: 'networkidle0' })

  const pdfBuffer = await page.pdf({
    format: 'A4',
    margin: { top: '2cm', right: '2cm', bottom: '2cm', left: '2.5cm' },
    printBackground: false,
  })

  await browser.close()
  return Buffer.from(pdfBuffer)
}

function textToHtml(text, caseData) {
  const lines = text.split('\n').map(line => {
    const trimmed = line.trim()
    if (trimmed.startsWith('## ')) return `<h2>${trimmed.slice(3)}</h2>`
    if (trimmed.startsWith('### ')) return `<h3>${trimmed.slice(4)}</h3>`
    if (trimmed === '') return '<br>'
    // Bold inline
    const withBold = trimmed.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    return `<p>${withBold}</p>`
  }).join('\n')

  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<style>
  body { font-family: "Times New Roman", serif; font-size: 12pt; line-height: 1.6; color: #000; }
  h1 { font-size: 18pt; text-align: center; margin-bottom: 24pt; }
  h2 { font-size: 13pt; margin-top: 18pt; margin-bottom: 8pt; border-bottom: 1px solid #000; padding-bottom: 3pt; }
  h3 { font-size: 12pt; margin-top: 12pt; margin-bottom: 6pt; }
  p  { margin: 0 0 8pt; text-align: justify; }
  .header { margin-bottom: 24pt; font-size: 11pt; color: #333; }
</style>
</head>
<body>
<h1>Betreuungsgutachten</h1>
<div class="header">Referenz: ${caseData?.patient_ref || ''} | ${caseData?.title || ''}</div>
${lines}
</body>
</html>`
}

export default router
