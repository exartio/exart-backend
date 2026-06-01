import { supabaseAdmin } from '../lib/supabase.js'
import { anthropic, GENERATION_MODEL } from '../lib/anthropicClient.js'
import { extractText } from '../lib/textExtraction.js'

// Process a court order (Gerichtsbeschluss):
// 1. Download from storage
// 2. OCR / extract text
// 3. Use Claude to extract Beweisfragen
// 4. Store questions + raw text back in cases table

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

    // Download file
    const { data: fileData, error: downloadError } = await supabaseAdmin.storage
      .from('case-documents')
      .download(caseRow.gerichtsbeschluss_storage_path)

    if (downloadError || !fileData) {
      throw new Error(`Failed to download court order: ${downloadError?.message}`)
    }

    const buffer = Buffer.from(await fileData.arrayBuffer())
    const ext = caseRow.gerichtsbeschluss_storage_path.split('.').pop()?.toLowerCase()
    const mimeType = getMimeType(ext)

    console.log(`[COURT] Extracting text from court order`)
    const rawText = await extractText(buffer, mimeType, `gerichtsbeschluss.${ext}`)

    console.log(`[COURT] Raw text length: ${rawText?.length || 0}`)
if (!rawText || rawText.length < 10) {
  throw new Error('Could not extract text from court order — file may be unreadable')
}

    console.log(`[COURT] Extracted ${rawText.length} chars, extracting Beweisfragen with Claude`)

    // Use Claude to extract the expert questions
    const message = await anthropic.messages.create({
      model: GENERATION_MODEL,
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: `Du analysierst einen deutschen Gerichtsbeschluss zur Einholung eines psychiatrischen Betreuungsgutachtens.

Extrahiere aus dem folgenden Text alle Beweisfragen / Gutachterfragen, die das Gericht an den Sachverständigen stellt.

Gib die Fragen als JSON-Array von Strings zurück. Jede Frage als eigenständiger String.
Wenn keine expliziten Fragen formuliert sind, leite die impliziten Begutachtungsaufgaben ab.
Antworte NUR mit dem JSON-Array, ohne weitere Erklärungen.

Beispiel-Ausgabe:
["Liegt bei der Betroffenen eine psychische Krankheit oder geistige bzw. seelische Behinderung vor?", "Ist die Betroffene aufgrund dieser Erkrankung nicht in der Lage, ihre Angelegenheiten selbst zu besorgen?", "Für welche Aufgabenkreise ist eine Betreuung erforderlich?"]

Gerichtsbeschluss:
${rawText.slice(0, 6000)}`
      }]
    })

    let beweisfragen = []
    try {
      const responseText = message.content[0]?.text?.trim() || '[]'
      // Strip markdown code fences if present
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
        beweisfragen_raw_text: rawText,
      })
      .eq('id', caseId)

    console.log(`[COURT] Completed extraction for case ${caseId}`)

  } catch (err) {
    console.error(`[COURT] Failed to process court order for case ${caseId}:`, err.message)
    await supabaseAdmin
      .from('cases')
      .update({
        gerichtsbeschluss_status: 'error',
      })
      .eq('id', caseId)
  }
}

function getMimeType(ext) {
  const map = {
    pdf:  'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    txt:  'text/plain',
    jpg:  'image/jpeg',
    jpeg: 'image/jpeg',
    png:  'image/png',
  }
  return map[ext] || 'application/octet-stream'
}
