import { supabaseAdmin } from '../lib/supabase.js'
import { anthropic, GENERATION_MODEL } from '../lib/anthropicClient.js'
import { pdfToPng } from 'pdf-to-png-converter'
import pdf from 'pdf-parse'
import mammoth from 'mammoth'

// Process a case_document record:
// 1. Download file from Supabase Storage
// 2. Try text extraction (pdf-parse / mammoth)
// 3. If scanned, convert to images and use Claude Vision
// 4. Store extracted_text back in case_documents
// 5. Update status

export async function processCaseDocument(documentId) {
  console.log(`[OCR] Starting extraction for document ${documentId}`)

  await supabaseAdmin
    .from('case_documents')
    .update({ status: 'processing' })
    .eq('id', documentId)

  try {
    const { data: doc, error: fetchError } = await supabaseAdmin
      .from('case_documents')
      .select('id, file_name, storage_path, doc_type')
      .eq('id', documentId)
      .single()

    if (fetchError || !doc) {
      throw new Error(`Document not found: ${documentId}`)
    }

    const { data: fileData, error: downloadError } = await supabaseAdmin.storage
      .from('case-documents')
      .download(doc.storage_path)

    if (downloadError || !fileData) {
      throw new Error(`Failed to download file: ${downloadError?.message}`)
    }

    const buffer = Buffer.from(await fileData.arrayBuffer())
    const ext = getMimeTypeFromFilename(doc.file_name)
    console.log(`[OCR] Extracting text from ${doc.file_name} (${doc.doc_type})`)

    let extractedText = ''

    if (ext === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      // DOCX — use mammoth
      const result = await mammoth.extractRawText({ buffer })
      extractedText = result.value?.trim() || ''
      console.log(`[OCR] DOCX extracted ${extractedText.length} chars`)
    } else if (ext === 'text/plain') {
      extractedText = buffer.toString('utf-8').trim()
    } else if (ext === 'application/pdf') {
      // Try pdf-parse first
      try {
        const pdfData = await pdf(buffer)
        extractedText = pdfData.text?.trim() || ''
        console.log(`[OCR] pdf-parse extracted ${extractedText.length} chars`)
      } catch {}

      if (extractedText.length < 100) {
        console.log(`[OCR] Scanned PDF — converting to images for Claude Vision`)
        extractedText = await extractWithClaudeVision(buffer, doc.file_name, doc.doc_type)
      }
    } else {
      // Image files — send directly to Claude Vision
      console.log(`[OCR] Image file — sending to Claude Vision`)
      extractedText = await extractImageWithClaude(buffer, ext, doc.file_name)
    }

    if (!extractedText || extractedText.length < 10) {
      throw new Error('Could not extract any text — file may be empty or unreadable')
    }

    console.log(`[OCR] Extracted ${extractedText.length} characters from ${doc.file_name}`)

    await supabaseAdmin
      .from('case_documents')
      .update({
        extracted_text: extractedText,
        status: 'ready',
        error_message: null,
      })
      .eq('id', documentId)

    console.log(`[OCR] Completed extraction for document ${documentId}`)

  } catch (err) {
    console.error(`[OCR] Failed to process document ${documentId}:`, err.message)
    await supabaseAdmin
      .from('case_documents')
      .update({ status: 'error', error_message: err.message })
      .eq('id', documentId)
  }
}

async function extractWithClaudeVision(buffer, fileName, docType) {
  const pages = await pdfToPng(buffer, {
    disableFontFace: true,
    useSystemFonts: true,
    viewportScale: 2.5,
  })

  console.log(`[OCR] Converted ${pages.length} pages to images for Claude Vision`)

  const docTypeLabels = {
    medical_scan: 'medizinische Akte / Scan',
    lab_report: 'Laborbericht',
    own_findings: 'ärztliche Befunde',
    court_order: 'Gerichtsbeschluss',
    other: 'medizinisches Dokument',
  }

  const messageContent = [
    {
      type: 'text',
      text: `Extrahiere den vollständigen Text aus den folgenden Seiten eines ${docTypeLabels[docType] || 'Dokuments'} (Datei: ${fileName}).`
    },
    ...pages.map(page => ({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: page.content.toString('base64'),
      }
    })),
    {
      type: 'text',
      text: `Gib den vollständigen extrahierten Text zurück — alle Seiten zusammen, in der richtigen Reihenfolge.
Behalte die Struktur bei (Überschriften, Absätze, Listen).
Keine Erklärungen, nur der extrahierte Text.`
    }
  ]

  const message = await anthropic.messages.create({
    model: GENERATION_MODEL,
    max_tokens: 4000,
    messages: [{ role: 'user', content: messageContent }]
  })

  return message.content[0]?.text?.trim() || ''
}

async function extractImageWithClaude(buffer, mimeType, fileName) {
  const message = await anthropic.messages.create({
    model: GENERATION_MODEL,
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: mimeType,
            data: buffer.toString('base64'),
          }
        },
        {
          type: 'text',
          text: `Extrahiere den vollständigen Text aus diesem Bild (${fileName}). Gib nur den extrahierten Text zurück, keine Erklärungen.`
        }
      ]
    }]
  })

  return message.content[0]?.text?.trim() || ''
}

function getMimeTypeFromFilename(filename) {
  const ext = filename.split('.').pop()?.toLowerCase()
  const map = {
    pdf:  'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    txt:  'text/plain',
    jpg:  'image/jpeg',
    jpeg: 'image/jpeg',
    png:  'image/png',
    tiff: 'image/tiff',
    tif:  'image/tiff',
  }
  return map[ext] || 'application/octet-stream'
}