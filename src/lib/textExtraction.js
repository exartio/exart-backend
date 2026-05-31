import pdf from 'pdf-parse'
import mammoth from 'mammoth'
import Tesseract from 'tesseract.js'
import { createCanvas } from 'canvas'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

// Load pdfjs in legacy mode for Node compatibility
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
pdfjsLib.GlobalWorkerOptions.workerSrc = join(
  __dirname, '../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'
)

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
    case 'image/tiff':
      return extractFromImage(buffer)
    default:
      throw new Error(`Unsupported file type for text extraction: ${mimeType}`)
  }
}

async function extractFromPdf(buffer) {
  try {
    const data = await pdf(buffer)
    const text = data.text?.trim()
    if (text && text.length >= 50) {
      return text
    }
    // PDF has no selectable text — scanned document, use pdfjs + OCR
    console.log('PDF appears to be a scan — converting pages to images for OCR')
    return extractFromScannedPdf(buffer)
  } catch (err) {
    throw new Error(`PDF extraction failed: ${err.message}`)
  }
}

async function extractFromScannedPdf(buffer) {
  try {
    const uint8Array = new Uint8Array(buffer)
    const loadingTask = pdfjsLib.getDocument({
      data: uint8Array,
      useWorkerFetch: false,
      isEvalSupported: false,
      useSystemFonts: true,
      disableWorker: true,
    })
    const pdfDoc = await loadingTask.promise
    const numPages = pdfDoc.numPages
    const pageTexts = []

    console.log(`[OCR] Processing ${numPages} page(s) via image OCR`)

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      const page = await pdfDoc.getPage(pageNum)
      const viewport = page.getViewport({ scale: 2.0 })

      const canvas = createCanvas(viewport.width, viewport.height)
      const ctx = canvas.getContext('2d')

      await page.render({
        canvasContext: ctx,
        viewport,
      }).promise

      const imageBuffer = canvas.toBuffer('image/png')

      const { data: { text } } = await Tesseract.recognize(imageBuffer, 'deu+eng', {
        logger: () => {},
      })

      if (text?.trim()) {
        pageTexts.push(text.trim())
      }

      console.log(`[OCR] Page ${pageNum}/${numPages} processed`)
    }

    return pageTexts.join('\n\n')
  } catch (err) {
    throw new Error(`Scanned PDF OCR failed: ${err.message}`)
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
      logger: () => {},
    })
    return text?.trim() || ''
  } catch (err) {
    throw new Error(`OCR failed: ${err.message}`)
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

  if (cleaned.length <= chunkSize) {
    return [cleaned]
  }

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
    if (breakPoint <= start) {
      breakPoint = cleaned.lastIndexOf(' ', end)
    }
    if (breakPoint <= start) {
      breakPoint = end
    }

    const chunk = cleaned.slice(start, breakPoint).trim()
    if (chunk.length > 0) chunks.push(chunk)

    start = breakPoint - overlap
    if (start < 0) start = 0
  }

  return chunks
}