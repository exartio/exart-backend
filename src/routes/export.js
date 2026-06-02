import express from 'express'
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, WidthType, BorderStyle, ShadingType,
  PageNumber, NumberFormat, TabStopType, TabStopPosition,
  HeadingLevel, PageBreak, UnderlineType
} from 'docx'
import PDFDocument from 'pdfkit'
import { supabaseAdmin } from '../lib/supabase.js'
import { requireAuth, checkAccess } from '../middleware/auth.js'

const router = express.Router()

// ── Helpers ───────────────────────────────────────────────────────────────────

function pt(n) { return n * 2 } // points to half-points (docx unit)

const FONT       = 'Calibri'
const FONT_MONO  = 'Courier New'
const COLOR_BODY = '1A1A1A'
const COLOR_LIGHT = '666666'

function para(children, opts = {}) {
  return new Paragraph({ children, ...opts })
}

function run(text, opts = {}) {
  return new TextRun({ text, font: FONT, ...opts })
}

function bold(text, size = 22) {
  return new TextRun({ text, font: FONT, bold: true, size: pt(size) })
}

function italic(text, size = 11) {
  return new TextRun({ text, font: FONT, italics: true, size: pt(size) })
}

function emptyLine() {
  return new Paragraph({ children: [new TextRun({ text: '' })] })
}

function hr() {
  return new Paragraph({
    children: [new TextRun({ text: '' })],
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC', space: 1 } },
  })
}

function sectionHeading(text) {
  return new Paragraph({
    children: [new TextRun({ text, font: FONT, bold: true, size: pt(11), color: COLOR_BODY })],
    spacing: { before: 240, after: 120 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'AAAAAA', space: 4 } },
  })
}

function questionHeading(label, text) {
  return new Paragraph({
    children: [
      new TextRun({ text: `${label}  `, font: FONT, bold: true, size: pt(11) }),
      new TextRun({ text, font: FONT, bold: true, size: pt(11) }),
    ],
    spacing: { before: 200, after: 80 },
  })
}

function bodyPara(text, opts = {}) {
  return new Paragraph({
    children: [new TextRun({ text, font: FONT, size: pt(11), color: COLOR_BODY })],
    spacing: { before: 0, after: 120 },
    ...opts,
  })
}

function labeledPara(label, text) {
  return new Paragraph({
    children: [
      new TextRun({ text: `${label}  –  `, font: FONT, bold: true, size: pt(11) }),
      new TextRun({ text, font: FONT, size: pt(11), color: COLOR_BODY }),
    ],
    spacing: { before: 60, after: 60 },
  })
}

// ── DOCX generation ───────────────────────────────────────────────────────────

async function generateDocx(output, caseRow, profile, org) {
  const text         = output.content_json?.text || ''
  const beweisfragen = caseRow.beweisfragen || []
  const caseDocs     = (caseRow.case_documents || []).filter(d => !d.ignored && d.status === 'ready')

  // Split case docs into own findings (B) and external sources (Q)
  const ownFindingTypes = ['exploration', 'untersuchung', 'amdp', 'own_findings']
  const befunde = caseDocs.filter(d => ownFindingTypes.includes(d.doc_type))
  const quellen = caseDocs.filter(d => !ownFindingTypes.includes(d.doc_type))

  const patientRef  = caseRow.patient_ref || ''
  const caseTitle   = caseRow.title || ''
  const aktenzeichen = caseRow.aktenzeichen || ''
  const gericht     = caseRow.gericht || ''
  const today       = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const docTitle    = `Psychiatrisches Gutachten${aktenzeichen ? ` zu ${aktenzeichen}` : ''}`

  // ── Header ────────────────────────────────────────────────────────────────
  const header = new Header({
    children: [
      new Paragraph({
        children: [
          new TextRun({ text: `Betreuungssache ${patientRef}`, font: FONT, size: pt(9), color: COLOR_LIGHT }),
          ...(aktenzeichen ? [new TextRun({ text: `  |  ${aktenzeichen}`, font: FONT, size: pt(9), color: COLOR_LIGHT })] : []),
        ],
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC', space: 4 } },
        spacing: { after: 80 },
      }),
    ],
  })

  // ── Footer ────────────────────────────────────────────────────────────────
  const fs = org?.footer_settings || {}
  const footerLines = [
    [org?.name || '', fs.email ? `E-Mail: ${fs.email}` : '', fs.steuer ? `Steuernummer: ${fs.steuer}` : ''],
    [profile?.full_name || '', fs.tel ? `Tel: ${fs.tel}` : '', fs.iban ? `IBAN: ${fs.iban}` : ''],
    [org?.address || '', fs.fax ? `Fax: ${fs.fax}` : '', fs.bank || ''],
  ]

  const footerParas = [
    new Paragraph({
      children: [new TextRun({ text: '', font: FONT })],
      border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC', space: 4 } },
      spacing: { before: 60, after: 40 },
    }),
  ]

  footerLines.forEach(cols => {
    footerParas.push(new Paragraph({
      children: [
        new TextRun({ text: cols[0], font: FONT, size: pt(8), color: COLOR_LIGHT }),
        new TextRun({ text: '\t', font: FONT, size: pt(8) }),
        new TextRun({ text: cols[1], font: FONT, size: pt(8), color: COLOR_LIGHT }),
        new TextRun({ text: '\t', font: FONT, size: pt(8) }),
        new TextRun({ text: cols[2], font: FONT, size: pt(8), color: COLOR_LIGHT }),
      ],
      tabStops: [
        { type: TabStopType.LEFT, position: 4000 },
        { type: TabStopType.LEFT, position: 8000 },
      ],
      spacing: { before: 0, after: 0 },
    }))
  })

  // Page number on last footer line
  footerParas.push(new Paragraph({
    children: [
      new TextRun({ text: '', font: FONT, size: pt(8) }),
      new TextRun({ text: '\t', font: FONT, size: pt(8) }),
      new TextRun({ text: 'Seite ', font: FONT, size: pt(8), color: COLOR_LIGHT }),
      new PageNumber({ font: FONT, size: pt(8), color: COLOR_LIGHT }),
    ],
    tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
    spacing: { before: 0, after: 0 },
  }))

  const footer = new Footer({ children: footerParas })

  // ── Document body ─────────────────────────────────────────────────────────
  const children = []

  // Letterhead
  children.push(
    para([bold(org?.name || 'Gutachtenpraxis', 11)], { spacing: { after: 60 } }),
    para([run('')], { spacing: { after: 20 } }),
    para([bold(`${profile?.full_name || ''}`, 12)], { spacing: { after: 40 } }),
    para([run(org?.address || '', { size: pt(10), color: COLOR_LIGHT })], { spacing: { after: 120 } }),
  )

  // Recipient block
  if (gericht) {
    children.push(
      emptyLine(),
      para([run(gericht, { size: pt(11) })], { spacing: { after: 40 } }),
      para([run('– Betreuungsgericht –', { size: pt(11), color: COLOR_LIGHT })], { spacing: { after: 40 } }),
      emptyLine(),
    )
  }

  // Date right-aligned
  children.push(
    new Paragraph({
      children: [run(`Magdeburg, ${today}`, { size: pt(11) })],
      alignment: AlignmentType.RIGHT,
      spacing: { before: 80, after: 200 },
    }),
  )

  // Title
  children.push(
    para([bold(docTitle, 13)], { spacing: { before: 120, after: 80 } }),
    emptyLine(),
  )

  // Salutation + intro
  children.push(
    bodyPara('Sehr geehrte Damen und Herren,'),
    bodyPara(`nachfolgend erstatte ich das angeforderte Gutachten in der Betreuungssache betreffend`),
    para([bold(patientRef, 11)], { spacing: { before: 40, after: 40 } }),
    bodyPara('Es soll beschlussgemäß zu Fragen der Notwendigkeit einer rechtlichen Betreuung Stellung genommen werden.'),
    emptyLine(),
  )

  // Befunde und Quellen
  if (befunde.length > 0 || quellen.length > 0) {
    children.push(sectionHeading('Dem Gutachten zugrunde liegende Befunde und Quellen'))
    befunde.forEach((d, i) => {
      children.push(labeledPara(`B${i + 1}`, d.file_name))
    })
    quellen.forEach((d, i) => {
      children.push(labeledPara(`Q${i + 1}`, d.file_name))
    })
    children.push(emptyLine())
  }

  // Gutachtenfragen + answers from generated text
  if (beweisfragen.length > 0) {
    children.push(sectionHeading('Gutachtenfragen'))

    // Try to split generated text by Beweisfragen sections
    const textLines = text.split('\n').filter(l => l.trim())
    beweisfragen.forEach((frage, idx) => {
      // Extract label from start of question (a), b), 1., 2. etc.)
      const labelMatch = frage.match(/^([a-zA-Z0-9]+[\)\.])/)
      const label = labelMatch ? labelMatch[1] : `${idx + 1}.`
      const questionText = labelMatch ? frage.slice(labelMatch[0].length).trim() : frage

      children.push(questionHeading(label, questionText))
      children.push(bodyPara(''))  // answer placeholder — filled from generated text
    })
    children.push(emptyLine())
  }

  // Main generated content
  if (text) {
    children.push(sectionHeading('Gutachten'))
    const paragraphs = text.split('\n\n').filter(p => p.trim())
    paragraphs.forEach(p => {
      const trimmed = p.trim()
      if (trimmed.startsWith('# ') || trimmed.startsWith('## ')) {
        const heading = trimmed.replace(/^#+ /, '')
        children.push(sectionHeading(heading))
      } else if (trimmed.startsWith('### ')) {
        const heading = trimmed.replace(/^### /, '')
        children.push(
          para([bold(heading, 11)], { spacing: { before: 160, after: 60 } })
        )
      } else if (trimmed) {
        // Check if italic (Zusammenfassend)
        if (trimmed.toLowerCase().startsWith('zusammenfassend')) {
          children.push(
            new Paragraph({
              children: [italic(trimmed, 11)],
              spacing: { before: 120, after: 120 },
            })
          )
        } else {
          children.push(bodyPara(trimmed))
        }
      }
    })
    children.push(emptyLine())
  }

  // Closing / signature block
  children.push(
    emptyLine(),
    bodyPara('Die Erstattung des vorliegenden Gutachtens erfolgt nach eigenständiger Befunderhebung'),
    bodyPara(`und Urteilsbildung nach bestem Wissen und Gewissen mit Stand ${today}`),
    emptyLine(),
    emptyLine(),
    para([bold(profile?.full_name || '', 11)], { spacing: { after: 40 } }),
    para([run(profile?.title || '', { size: pt(10), color: COLOR_LIGHT })], { spacing: { after: 40 } }),
  )

  // ── Build document ────────────────────────────────────────────────────────
  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: FONT, size: pt(11), color: COLOR_BODY },
          paragraph: { spacing: { line: 276 } }, // 1.15 line spacing
        },
      },
    },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 }, // A4
          margin: { top: 1418, right: 1134, bottom: 1418, left: 1701 }, // 2.5cm left, 2cm right
        },
      },
      headers: { default: header },
      footers: { default: footer },
      children,
    }],
  })

  return await Packer.toBuffer(doc)
}

// ── Routes ────────────────────────────────────────────────────────────────────

// POST /api/export
// Body: { output_id, format: 'docx' | 'pdf' }
router.post('/', requireAuth, checkAccess, async (req, res) => {
  const { output_id, format = 'docx' } = req.body
  if (!output_id) return res.status(400).json({ error: 'output_id required' })

  // Load output
  const { data: output, error: outputError } = await supabaseAdmin
    .from('generated_outputs')
    .select('id, case_id, version, content_json')
    .eq('id', output_id)
    .single()

  if (outputError || !output) return res.status(404).json({ error: 'Output not found' })

  // Load case with documents
  const { data: caseRow, error: caseError } = await supabaseAdmin
    .from('cases')
    .select(`
      id, title, patient_ref, aktenzeichen, gericht, beauftragungsdatum, beweisfragen,
      case_documents ( id, file_name, doc_type, status, ignored )
    `)
    .eq('id', output.case_id)
    .single()

  if (caseError || !caseRow) return res.status(404).json({ error: 'Case not found' })

  // Load profile and org
  const { data: member } = await supabaseAdmin
    .from('organization_members')
    .select('org_id, organizations(name, address, footer_settings)')
    .eq('user_id', req.user.id)
    .single()

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('full_name, title')
    .eq('auth_user_id', req.user.id)
    .single()

  const org = member?.organizations

  try {
    const filename = `Gutachten_${(caseRow.patient_ref || 'export').replace(/\s+/g, '_')}_v${output.version}`

    if (format === 'docx') {
      const buffer = await generateDocx(output, caseRow, profile, org)
      const path   = `exports/${output.case_id}/${output_id}_v${output.version}.docx`

      const { error: storageError } = await supabaseAdmin.storage
        .from('exports')
        .upload(path, buffer, { contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', upsert: true })

      if (storageError) throw storageError

      const { data: { signedUrl } } = await supabaseAdmin.storage
        .from('exports')
        .createSignedUrl(path, 3600)

      return res.json({ url: signedUrl, filename: `${filename}.docx` })
    }

    if (format === 'pdf') {
      // Generate DOCX first, then return a download of the text as PDF via pdfkit
      // (Full PDF styling is handled client-side via Word → Save as PDF)
      const pdfBuffer = await generatePdfFallback(output, caseRow, profile, org)
      const path = `exports/${output.case_id}/${output_id}_v${output.version}.pdf`

      const { error: storageError } = await supabaseAdmin.storage
        .from('exports')
        .upload(path, pdfBuffer, { contentType: 'application/pdf', upsert: true })

      if (storageError) throw storageError

      const { data: { signedUrl } } = await supabaseAdmin.storage
        .from('exports')
        .createSignedUrl(path, 3600)

      return res.json({ url: signedUrl, filename: `${filename}.pdf` })
    }

    res.status(400).json({ error: 'Invalid format' })

  } catch (err) {
    console.error('[EXPORT] Error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/export/outputs/:caseId
// List all outputs for a case
router.get('/case/:caseId/outputs', requireAuth, async (req, res) => {
  const { data: outputs, error } = await supabaseAdmin
    .from('generated_outputs')
    .select('id, version, created_at, is_demo')
    .eq('case_id', req.params.caseId)
    .order('version', { ascending: false })

  if (error) return res.status(500).json({ error: error.message })
  res.json({ outputs })
})

// ── PDF fallback (pdfkit) ─────────────────────────────────────────────────────

async function generatePdfFallback(output, caseRow, profile, org) {
  return new Promise((resolve, reject) => {
    const chunks = []
    const doc = new PDFDocument({ size: 'A4', margin: 72, info: {
      Title: `Gutachten ${caseRow.patient_ref || ''}`,
      Author: profile?.full_name || '',
    }})

    doc.on('data', chunk => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const today = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
    const text  = output.content_json?.text || ''

    // Header line
    doc.fontSize(8).fillColor('#888888')
       .text(`Betreuungssache ${caseRow.patient_ref || ''} | ${caseRow.aktenzeichen || ''}`, { align: 'left' })
    doc.moveDown(0.5)

    // Title
    doc.fontSize(13).fillColor('#1a1a1a').font('Helvetica-Bold')
       .text(`Psychiatrisches Gutachten${caseRow.aktenzeichen ? ` zu ${caseRow.aktenzeichen}` : ''}`)
    doc.moveDown(0.5)

    // Date
    doc.fontSize(10).fillColor('#444444').font('Helvetica')
       .text(`Magdeburg, ${today}`, { align: 'right' })
    doc.moveDown(1)

    // Body text
    doc.fontSize(10.5).fillColor('#1a1a1a').font('Helvetica')

    const paragraphs = text.split('\n\n').filter(p => p.trim())
    paragraphs.forEach(p => {
      const trimmed = p.trim()
      if (trimmed.startsWith('# ') || trimmed.startsWith('## ')) {
        doc.moveDown(0.5)
        doc.font('Helvetica-Bold').fontSize(11).text(trimmed.replace(/^#+ /, ''))
        doc.font('Helvetica').fontSize(10.5)
        doc.moveDown(0.3)
      } else if (trimmed.startsWith('### ')) {
        doc.moveDown(0.3)
        doc.font('Helvetica-Bold').fontSize(10.5).text(trimmed.replace(/^### /, ''))
        doc.font('Helvetica').fontSize(10.5)
        doc.moveDown(0.2)
      } else if (trimmed) {
        doc.text(trimmed, { align: 'justify', lineGap: 2 })
        doc.moveDown(0.4)
      }
    })

    // Signature
    doc.moveDown(2)
    doc.font('Helvetica-Bold').fontSize(10.5).text(profile?.full_name || '')
    if (profile?.title) {
      doc.font('Helvetica').fontSize(9).fillColor('#666666').text(profile.title)
    }

    // Footer with page numbers
    const range = doc.bufferedPageRange()
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i)
      doc.fontSize(8).fillColor('#888888')
         .text(`Seite ${i + 1} / ${range.count}`, 72, doc.page.height - 40, { align: 'right' })
      if (org?.name) {
        doc.text(org.name, 72, doc.page.height - 40, { align: 'left' })
      }
    }

    doc.end()
  })
}

export default router