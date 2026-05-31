import pdf from 'pdf-parse'
import mammoth from 'mammoth'
import Tesseract from 'tesseract.js'

// Extract plain text from a file buffer based on its MIME type
export async function extractText(buffer, mimeType, filename) {
  switch (mimeType) {
    case 'application/pdf':
      return extractFromPdf(buffer)

    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return extractFromDocx(buffer)

    case 'text/plain':
      return buffer.toString('utf-8')

    case 'image/jpeg':
    case 'image/png':
      return extractFromImage(buffer)

    default:
      throw new Error(`Unsupported file type for text extraction: ${mimeType}`)
  }
}

async function extractFromPdf(buffer) {
  try {
    const data = await pdf(buffer)
    const text = data.text?.trim()

    if (!text || text.length < 50) {
      // PDF has no selectable text — likely a scanned image
      // Fall back to OCR on the raw buffer
      console.log('PDF appears to be a scan — falling back to OCR')
      return extractFromImage(buffer)
    }

    return text
  } catch (err) {
    throw new Error(`PDF extraction failed: ${err.message}`)
  }
}

async function extractFromDocx(buffer) {
  try {
    const result = await mammoth.extractRawText({ buffer })
    return result.value?.trim() || ''
  } catch (err) {
    throw new Error(`DOCX extraction failed: ${err.message}`)
  }
}

async function extractFromImage(buffer) {
  try {
    const { data: { text } } = await Tesseract.recognize(buffer, 'deu+eng', {
      // deu = German, eng = English — handles mixed language medical docs
      logger: () => {}, // suppress progress logs
    })
    return text?.trim() || ''
  } catch (err) {
    throw new Error(`OCR failed: ${err.message}`)
  }
}


// Split text into overlapping chunks suitable for embedding
// chunk_size: target characters per chunk
// overlap: characters shared between adjacent chunks (preserves context)
export function chunkText(text, chunkSize = 1000, overlap = 150) {
  if (!text || text.length === 0) return []

  // Clean up excessive whitespace
  const cleaned = text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()

  if (cleaned.length <= chunkSize) {
    return [cleaned]
  }

  const chunks = []
  let start = 0

  while (start < cleaned.length) {
    let end = start + chunkSize

    if (end >= cleaned.length) {
      // Last chunk — take everything remaining
      chunks.push(cleaned.slice(start).trim())
      break
    }

    // Try to break at a paragraph boundary first
    let breakPoint = cleaned.lastIndexOf('\n\n', end)

    // Fall back to sentence boundary
    if (breakPoint <= start) {
      breakPoint = cleaned.lastIndexOf('. ', end)
      if (breakPoint > start) breakPoint += 1 // include the period
    }

    // Fall back to word boundary
    if (breakPoint <= start) {
      breakPoint = cleaned.lastIndexOf(' ', end)
    }

    // Fall back to hard cut
    if (breakPoint <= start) {
      breakPoint = end
    }

    const chunk = cleaned.slice(start, breakPoint).trim()
    if (chunk.length > 0) chunks.push(chunk)

    // Next chunk starts overlap characters before the end of this one
    start = breakPoint - overlap
    if (start < 0) start = 0
  }

  return chunks
}
