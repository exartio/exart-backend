import { supabaseAdmin } from '../lib/supabase.js'
import { anthropic, GENERATION_MODEL } from '../lib/anthropicClient.js'

// Process a court order (Gerichtsbeschluss):
// 1. Download from storage
// 2. Send PDF directly to Claude as a document (native PDF support)
// 3. Extract Beweisfragen + case metadata (court, judge, date, Betroffener)
// 4. Store everything back in cases table

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

    const message = await anthropic.messages.create({
      model: GENERATION_MODEL,
      max_tokens: 3000,
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
            text: `Analysiere diesen deutschen Gerichtsbeschluss und extrahiere alle relevanten Informationen.

Gib das Ergebnis als JSON-Objekt zurück mit folgender Struktur:

{
  "beweisfragen": ["Frage 1", "Frage 2"],
  "gericht": "Name des Gerichts (z. B. Amtsgericht Musterstadt)",
  "aktenzeichen": "Aktenzeichen (z. B. 17 XVII B 234/25)",
  "richter": "Name des Richters / der Richterin (z. B. Dr. Müller)",
  "beschlussdatum": "YYYY-MM-DD oder null",
  "abgabefrist": "YYYY-MM-DD oder null",
  "betroffener_name": "Vollständiger Name der betroffenen Person",
  "betroffener_dob": "YYYY-MM-DD oder null",
  "betroffener_adresse": "Vollständige Adresse der betroffenen Person oder null"
}

Hinweise:
- beweisfragen: alle Gutachterfragen / Beweisfragen wortgetreu aus dem Dokument, als Array
- beschlussdatum: Datum des Beschlusses / der Verfügung
- abgabefrist: Frist zur Erstattung des Gutachtens, falls angegeben
- richter: nur der Name, ohne Titel falls nicht im Dokument, null wenn nicht erkennbar
- Falls ein Wert nicht im Dokument enthalten ist, setze null
- Antworte NUR mit dem JSON-Objekt, ohne Erklärungen, ohne Markdown-Backticks`
          }
        ]
      }]
    })

    // Parse JSON response
    let extracted = {}
    try {
      const responseText = message.content[0]?.text?.trim() || '{}'
      const clean = responseText.replace(/```json|```/g, '').trim()
      extracted = JSON.parse(clean)
    } catch {
      console.warn('[COURT] Could not parse extraction JSON, using empty defaults')
      extracted = {}
    }

    const beweisfragen = Array.isArray(extracted.beweisfragen) ? extracted.beweisfragen : []

    console.log(`[COURT] Extracted ${beweisfragen.length} Beweisfragen`)
    console.log(`[COURT] Gericht: ${extracted.gericht || '—'}`)
    console.log(`[COURT] Richter: ${extracted.richter || '—'}`)
    console.log(`[COURT] Beschlussdatum: ${extracted.beschlussdatum || '—'}`)
    console.log(`[COURT] Abgabefrist: ${extracted.abgabefrist || '—'}`)
    console.log(`[COURT] Betroffener: ${extracted.betroffener_name || '—'}`)

    // Build update object — only set fields that were actually extracted
    const updates = {
      gerichtsbeschluss_status: 'ready',
      beweisfragen,
      beweisfragen_raw_text: '[extracted via Claude PDF vision]',
    }

    if (extracted.gericht)            updates.gericht            = extracted.gericht
    if (extracted.aktenzeichen)       updates.aktenzeichen       = extracted.aktenzeichen
    if (extracted.richter)            updates.richter             = extracted.richter
    if (extracted.beschlussdatum)     updates.beschlussdatum      = extracted.beschlussdatum
    if (extracted.abgabefrist)        updates.abgabefrist         = extracted.abgabefrist
    if (extracted.betroffener_name)   updates.betroffener_name    = extracted.betroffener_name
    if (extracted.betroffener_dob)    updates.betroffener_dob     = extracted.betroffener_dob
    if (extracted.betroffener_adresse) updates.betroffener_adresse = extracted.betroffener_adresse

    await supabaseAdmin
      .from('cases')
      .update(updates)
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