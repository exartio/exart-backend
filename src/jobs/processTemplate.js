import { supabaseAdmin } from '../lib/supabase.js'
import { anthropic, GENERATION_MODEL } from '../lib/anthropicClient.js'
import mammoth from 'mammoth'
import pdf from 'pdf-parse'

// Process an uploaded Gutachten template:
// 1. Download from storage
// 2. Extract raw text
// 3. Use Claude to extract structure (chapters, intro, closing)
// 4. Store both raw_text and structure_json back in templates table

export async function processTemplate(templateId) {
  console.log(`[TPL] Starting processing for template ${templateId}`)

  await supabaseAdmin
    .from('templates')
    .update({ status: 'processing' })
    .eq('id', templateId)

  try {
    const { data: template, error: fetchError } = await supabaseAdmin
      .from('templates')
      .select('id, name, storage_path')
      .eq('id', templateId)
      .single()

    if (fetchError || !template?.storage_path) {
      throw new Error(`Template not found: ${templateId}`)
    }

    const { data: fileData, error: downloadError } = await supabaseAdmin.storage
      .from('templates')
      .download(template.storage_path)

    if (downloadError || !fileData) {
      throw new Error(`Failed to download template: ${downloadError?.message}`)
    }

    const buffer = Buffer.from(await fileData.arrayBuffer())
    const ext    = template.storage_path.split('.').pop()?.toLowerCase()

    // Extract raw text
    let rawText = ''
    if (ext === 'docx') {
      const result = await mammoth.extractRawText({ buffer })
      rawText = result.value?.trim() || ''
    } else if (ext === 'pdf') {
      try {
        const pdfData = await pdf(buffer)
        rawText = pdfData.text?.trim() || ''
      } catch {}
      // Fall back to Claude if pdf-parse fails
      if (rawText.length < 100) {
        const msg = await anthropic.messages.create({
          model: GENERATION_MODEL,
          max_tokens: 4000,
          messages: [{
            role: 'user',
            content: [
              { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') } },
              { type: 'text', text: 'Extrahiere den vollständigen Text aus diesem Dokument. Nur der Text, keine Erklärungen.' }
            ]
          }]
        })
        rawText = msg.content[0]?.text?.trim() || ''
      }
    }

    if (!rawText || rawText.length < 50) {
      throw new Error('Could not extract text from template')
    }

    console.log(`[TPL] Extracted ${rawText.length} chars, extracting structure with Claude`)

    // Use Claude to extract structure
    const structureMsg = await anthropic.messages.create({
      model: GENERATION_MODEL,
      max_tokens: 3000,
      messages: [{
        role: 'user',
        content: `Analysiere diese Gutachten-Vorlage und extrahiere die Struktur als JSON.

Vorlage:
${rawText.slice(0, 8000)}

Gib ein JSON-Objekt mit folgenden Feldern zurück:
- "chapters": Array von Strings — die Kapitelüberschriften in der gewünschten Reihenfolge
- "intro": String — Standardeinleitung / Vorbemerkungstext (falls vorhanden, sonst null)
- "closing": String — Schlussformel / Autorenschaft-Erklärung (falls vorhanden, sonst null)
- "style_notes": String — sonstige Stilhinweise oder Besonderheiten (falls vorhanden, sonst null)

Antworte NUR mit dem JSON-Objekt, ohne Erklärungen, ohne Markdown-Backticks.`
      }]
    })

    let structureJson = {}
    try {
      const responseText = structureMsg.content[0]?.text?.trim() || '{}'
      const clean = responseText.replace(/```json|```/g, '').trim()
      structureJson = JSON.parse(clean)
    } catch {
      console.warn('[TPL] Could not parse structure JSON')
      structureJson = { chapters: [], intro: null, closing: null, style_notes: null }
    }

    console.log(`[TPL] Extracted ${structureJson.chapters?.length || 0} chapters`)

    await supabaseAdmin
      .from('templates')
      .update({
        raw_text:     rawText,
        content_json: structureJson,
        status:       'ready',
      })
      .eq('id', templateId)

    console.log(`[TPL] Completed processing for template ${templateId}`)

  } catch (err) {
    console.error(`[TPL] Failed to process template ${templateId}:`, err.message)
    await supabaseAdmin
      .from('templates')
      .update({ status: 'error' })
      .eq('id', templateId)
  }
}