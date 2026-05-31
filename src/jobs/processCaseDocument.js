import { supabaseAdmin } from '../lib/supabase.js'
import { extractText } from '../lib/textExtraction.js'

// Process a case_document record:
// 1. Download file from Supabase Storage
// 2. Extract / OCR text
// 3. Store extracted_text back in case_documents
// 4. Update status
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
    const extractedText = await extractText(buffer, mimeType, doc.file_name)

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

// Derive MIME type from file extension
function getMimeTypeFromFilename(filename) {
  const ext = filename.split('.').pop().toLowerCase()
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