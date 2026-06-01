import { supabaseAdmin } from '../lib/supabase.js'
import { anthropic, GENERATION_MODEL } from '../lib/anthropicClient.js'
import mammoth from 'mammoth'
import pdf from 'pdf-parse'

// Process a case_document record:
// 1. Download file from Supabase Storage
// 2. For DOCX/TXT: extract text directly
// 3. For PDF: try pdf-parse first, fall back to Claude native PDF
// 4. For images: send to Claude Vision
// 5. Store extracted_text back in case_documents

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
    const mimeType = getMimeTypeFromFilename(doc.file_name)

    console.log(`[OCR] Extracting text from ${doc.file_name} (${doc.doc_type})`)

    let extractedText = ''

    if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      // DOCX — use mammoth
      const result = await mammoth.extractRawText({ buffer })
      extractedText = result.value?.trim() || ''
      console.log(`[OCR] DOCX extracted ${extractedText.length} chars`)

    } else if (mimeType === 'text/plain') {
      extractedText = buffer.toString('utf-8').trim()
      console.log(`[OCR] TXT extracted ${extractedText.length} chars`)

    } else if (mimeType === 'application/pdf') {
      // Try pdf-parse first (fast, no API cost)
      try {
        const pdfData = await pdf(buffer)
        extractedText = pdfData.text?.trim() || ''
        console.log(`[OCR] pdf-parse extracted ${extractedText.length} chars`)
      } catch {}

      // Fall back to Claude native PDF if text is too short
      if (extractedText.length < 100) {
        console.log(`[OCR] Scanned PDF — sending to Claude natively`)
        extractedText = await extractPdfWithClaude(buffer, doc.file_name, doc.doc_type)
      }

    } else if (['image/jpeg', 'image/png', 'image/tiff'].includes(mimeType)) {
      // Image — send to Claude Vision
      console.log(`[OCR] Image — sending to Claude Vision`)
      extractedText = await extractImageWithClaude(buffer, mimeType, doc.file_name)
    } else {
      throw new Error(`Unsupported file type: ${mimeType}`)
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

async function extractPdfWithClaude(buffer, fileName, docType) {
  const docTypeLabels = {
    medical_scan: 'medizinische Akte / Scan',
    lab_report: 'Laborbericht',
    own_findings: 'ärztliche Befunde',
    court_order: 'Gerichtsbeschluss',
    other: 'medizinisches Dokument',
  }

  const message = await anthropic.messages.create({
    model: GENERATION_MODEL,
    max_tokens: 4000,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: buffer.toString('base64'),
          }
        },
        {
          type: 'text',
          text: `Extrahiere den vollständigen Text aus diesem ${docTypeLabels[docType] || 'Dokument'} (${fileName}).
Behalte die Struktur bei — Überschriften, Absätze, Listen, Tabellen.
Gib nur den extrahierten Text zurück, keine Erklärungen oder Kommentare.`
        }
      ]
    }]
  })

  const text = message.content[0]?.text?.trim() || ''
  console.log(`[OCR] Claude extracted ${text.length} chars from PDF`)
  return text
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
            media_type: mimeType === 'image/tiff' ? 'image/jpeg' : mimeType,
            data: buffer.toString('base64'),
          }
        },
        {
          type: 'text',
          text: `Extrahiere den vollständigen Text aus diesem Bild (${fileName}).
Behalte die Struktur bei.
Gib nur den extrahierten Text zurück, keine Erklärungen.`
        }
      ]
    }]
  })

  const text = message.content[0]?.text?.trim() || ''
  console.log(`[OCR] Claude extracted ${text.length} chars from image`)
  return text
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