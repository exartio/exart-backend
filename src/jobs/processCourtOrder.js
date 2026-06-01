import { supabaseAdmin } from '../lib/supabase.js'
import { anthropic, GENERATION_MODEL } from '../lib/anthropicClient.js'
import { pdfToPng } from 'pdf-to-png-converter'
import pdf from 'pdf-parse'

// Process a court order (Gerichtsbeschluss):
// 1. Download from storage
// 2. Try text extraction first (pdf-parse)
// 3. If scanned, convert to images and send to Claude Vision
// 4. Use Claude to extract Beweisfragen
// 5. Store questions + raw text back in cases table

export async function processCourtOrder(caseId) {
  console.log(`[COURT] Starting extraction for case ${caseId}`)

  await supabaseAdmin
    .from('cases')
    .update({ gerichtsbeschluss_status: 'processing' })
    .eq('id', caseId)

  try {
    const { data: caseRow, error: fetchError } = await supabaseAdmin
      .from('cases')
      .select('id, org_id, gerichtsbeschluss_storage_path')
      .eq('id', caseId)
      .single()

    if (fetchError || !caseRow?.gerichtsbeschluss_storage_path) {
      throw new Error(`Case or storage path not found: ${caseId}`)
    }

    const { data: fileData, error: downloadError } = await supabaseAdmin.storage
      .from('case-documents')
      .download(caseRow.gerichtsbeschluss_storage_path)

    if (downloadError || !fileData) {
      throw new Error(`Failed to download court order: ${downloadError?.message}`)
    }

    const buffer = Buffer.from(await fileData.arrayBuffer())

    // Try text extraction first
    let rawText = ''
    try {
      const pdfData = await pdf(buffer)
      rawText = pdfData.text?.trim() || ''
      console.log(`[COURT] pdf-parse extracted ${rawText.length} chars`)
    } catch {}

    let messageContent = []

    if (rawText.length >= 100) {
      console.log(`[COURT] Using extracted text for Claude`)
      messageContent = [{
        type: 'text',
        text: `Analysiere diesen deutschen Gerichtsbeschluss und extrahiere die Beweisfragen:\n\n${rawText.slice(0, 8000)}`
      }]
    } else {
      console.log(`[COURT] Scanned PDF — converting to images for Claude Vision`)

      const pages = await pdfToPng(buffer, {
        disableFontFace: true,
        useSystemFonts: true,
        viewportScale: 2.5,
      })

      console.log(`[COURT] Converted ${pages.length} pages to images`)

      messageContent = [
        {
          type: 'text',
          text: 'Analysiere diese Seiten eines deutschen Gerichtsbeschlusses zur Einholung eines psychiatrischen Betreuungsgutachtens.'
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
          text: `Extrahiere aus den Seiten alle Beweisfragen / Gutachterfragen, die das Gericht an den Sachverständigen stellt.

Gib die Fragen als JSON-Array von Strings zurück. Jede Frage als eigenständiger String, vollständig ausformuliert.
Wenn keine expliziten Fragen formuliert sind, leite die impliziten Begutachtungsaufgaben ab.
Antworte NUR mit dem JSON-Array, ohne weitere Erklärungen, ohne Markdown-Backticks.

Beispiel: ["Liegt bei dem Betroffenen eine Krankheit vor?", "Welche Angelegenheiten kann der Betroffene nicht selbst besorgen?"]`
        }
      ]
    }

    const message = await anthropic.messages.create({
      model: GENERATION_MODEL,
      max_tokens: 2000,
      messages: [{ role: 'user', content: messageContent }]
    })

    let beweisfragen = []
    try {
      const responseText = message.content[0]?.text?.trim() || '[]'
      const clean = responseText.replace(/```json|```/g, '').trim()
      beweisfragen = JSON.parse(clean)
      if (!Array.isArray(beweisfragen)) beweisfragen = []
    } catch {
      console.warn('[COURT] Could not parse Beweisfragen JSON, storing empty array')
      beweisfragen = []
    }

    console.log(`[COURT] Extracted ${beweisfragen.length} Beweisfragen`)

    await supabaseAdmin
      .from('cases')
      .update({
        gerichtsbeschluss_status: 'ready',
        beweisfragen,
        beweisfragen_raw_text: rawText || '[extracted via vision]',
      })
      .eq('id', caseId)

    console.log(`[COURT] Completed extraction for case ${caseId}`)

  } catch (err) {
    console.error(`[COURT] Failed to process court order for case ${caseId}:`, err.message)
    await supabaseAdmin
      .from('cases')
      .update({ gerichtsbeschluss_status: 'error' })
      .eq('id', caseId)
  }
}