import { supabaseAdmin } from '../lib/supabase.js'
import { anthropic, GENERATION_MODEL } from '../lib/anthropicClient.js'
import pdf from 'pdf-parse'

// Process a court order (Gerichtsbeschluss):
// 1. Download from storage
// 2. Send PDF directly to Claude as a document (native PDF support)
// 3. Extract Beweisfragen
// 4. Store questions back in cases table

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
    const base64Pdf = buffer.toString('base64')

    console.log(`[COURT] Sending PDF to Claude (${buffer.length} bytes)`)

    // Send PDF natively to Claude — works for both text and scanned PDFs
    const message = await anthropic.messages.create({
      model: GENERATION_MODEL,
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: base64Pdf,
            }
          },
          {
            type: 'text',
            text: `Analysiere diesen deutschen Gerichtsbeschluss zur Einholung eines psychiatrischen Betreuungsgutachtens.

Extrahiere alle Beweisfragen / Gutachterfragen, die das Gericht an den Sachverständigen stellt — üblicherweise als nummerierte oder alphabetisch geordnete Liste.

Gib die Fragen als JSON-Array von Strings zurück. Jede Frage vollständig und wortgetreu aus dem Dokument übernommen.
Antworte NUR mit dem JSON-Array, ohne Erklärungen, ohne Markdown-Backticks.

Beispiel: ["Liegt bei dem Betroffenen eine Krankheit vor?", "Welche Angelegenheiten kann der Betroffene nicht selbst besorgen?"]`
          }
        ]
      }]
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
    beweisfragen.forEach((f, i) => console.log(`[COURT] ${i+1}. ${f}`))

    await supabaseAdmin
      .from('cases')
      .update({
        gerichtsbeschluss_status: 'ready',
        beweisfragen,
        beweisfragen_raw_text: '[extracted via Claude PDF vision]',
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