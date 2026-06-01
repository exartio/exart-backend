import pdf from 'pdf-parse'
import mammoth from 'mammoth'

// Extract plain text from a file buffer based on its MIME type
// Note: scanned PDFs and images are now handled by Claude Vision in the job files
export async function extractText(buffer, mimeType, filename) {
  switch (mimeType) {
    case 'application/pdf':
      return extractFromPdf(buffer)
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return extractFromDocx(buffer)
    case 'text/plain':
      return buffer.toString('utf-8').trim()
    default:
      throw new Error(`Unsupported file type for text extraction: ${mimeType}`)
  }
}

async function extractFromPdf(buffer) {
  try {
    const data = await pdf(buffer)
    return data.text?.trim() || ''
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

// Split text into overlapping chunks suitable for embedding
export function chunkText(text, chunkSize = 1000, overlap = 150) {
  if (!text || text.length === 0) return []

  const cleaned = text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()

  if (cleaned.length <= chunkSize) return [cleaned]

  const chunks = []
  let start = 0

  while (start < cleaned.length) {
    let end = start + chunkSize
    if (end >= cleaned.length) {
      chunks.push(cleaned.slice(start).trim())
      break
    }
    let breakPoint = cleaned.lastIndexOf('\n\n', end)
    if (breakPoint <= start) {
      breakPoint = cleaned.lastIndexOf('. ', end)
      if (breakPoint > start) breakPoint += 1
    }
    if (breakPoint <= start) breakPoint = cleaned.lastIndexOf(' ', end)
    if (breakPoint <= start) breakPoint = end

    const chunk = cleaned.slice(start, breakPoint).trim()
    if (chunk.length > 0) chunks.push(chunk)
    start = breakPoint - overlap
    if (start < 0) start = 0
  }

  return chunks
}