import express from 'express'
import { supabaseAdmin } from '../lib/supabase.js'
import { anthropic, GENERATION_MODEL } from '../lib/anthropicClient.js'
import { buildSystemPrompt, buildUserPrompt } from '../lib/promptBuilder.js'
import { retrieveRelevantChunks } from '../jobs/processStatement.js'
import { requireAuth, checkAccess } from '../middleware/auth.js'
import { checkGenerationQuota, incrementGenerationQuota } from '../lib/quotaService.js'

const router = express.Router()

async function getUserContext(authUserId) {
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('id, org_id')
    .eq('auth_user_id', authUserId)
    .single()
  return data
}


// POST /api/generate
router.post('/', requireAuth, checkAccess, async (req, res) => {
  const { case_id, own_findings = [], template_id, gutachten_type = 'betreuung', use_own_style = true } = req.body

  if (!case_id) return res.status(400).json({ error: 'case_id is required' })

  const profile = await getUserContext(req.user.id)
  if (!profile?.org_id) return res.status(400).json({ error: 'User has no organisation' })

  const isDemo = req.accessLevel !== 'full'


  // ── Generation quota check (per case) ───────────────────
  if (!isDemo) {
    const genQuota = await checkGenerationQuota(case_id)
    if (!genQuota.allowed) {
      return res.status(402).json({
        error: `Generierungslimit für diesen Fall erreicht (${genQuota.count}/${genQuota.max}). Bitte erstellen Sie einen neuen Fall oder wechseln Sie zur Expert-Lizenz für mehr Generierungen.`,
        reason: genQuota.reason,
        count: genQuota.count,
        max: genQuota.max,
      })
    }
  }

  // ── 1. Load case — now including beweisfragen ─────────────
  const { data: caseRow, error: caseError } = await supabaseAdmin
    .from('cases')
    .select(`
      id, patient_ref, title, template_id,
      beweisfragen, beweisfragen_raw_text, gerichtsbeschluss_status,
      case_documents ( id, file_name, doc_type, status, extracted_text, ignored ),
      templates ( id, name, content_json )
    `)
    .eq('id', case_id)
    .eq('org_id', profile.org_id)
    .single()

  if (caseError || !caseRow) {
    return res.status(404).json({ error: 'Case not found' })
  }

  // ── 2. Load template ──────────────────────────────────────
  let template = caseRow.templates
  if (template_id && template_id !== caseRow.template_id) {
    const { data: overrideTemplate } = await supabaseAdmin
      .from('templates')
      .select('id, name, content_json')
      .eq('id', template_id)
      .single()
    if (overrideTemplate) template = overrideTemplate
  }

  // ── 3. Check all documents are processed ─────────────────
  const pendingDocs = caseRow.case_documents.filter(
    d => d.status === 'pending' || d.status === 'processing'
  )
  if (pendingDocs.length > 0 && !isDemo) {
    return res.status(409).json({
      error: 'Some documents are still being processed',
      pending_count: pendingDocs.length,
      message: 'Please wait for all documents to finish processing before generating',
    })
  }

  // ── 4. Retrieve RAG chunks ────────────────────────────────
  let retrievedChunks = []
  if (use_own_style && !isDemo) {
    try {
      const queryText = [
        caseRow.title,
        caseRow.case_documents
          .filter(d => d.extracted_text)
          .map(d => d.extracted_text?.slice(0, 200))
          .join(' '),
      ].filter(Boolean).join(' ')

      retrievedChunks = await retrieveRelevantChunks(profile.org_id, queryText, 8)
      console.log(`[GEN] Retrieved ${retrievedChunks.length} relevant chunks for case ${case_id}`)
    } catch (err) {
      console.warn('[GEN] RAG retrieval failed, proceeding without style chunks:', err.message)
    }
  }

  // ── 5. Build prompt — now with beweisfragen ───────────────
  const systemPrompt = buildSystemPrompt(gutachten_type)
  const userPrompt = buildUserPrompt({
    caseDocuments: caseRow.case_documents,
    ownFindings: own_findings,
    retrievedChunks,
    template,
    patientRef: caseRow.patient_ref,
    beweisfragen: caseRow.beweisfragen || [],
    isDemo,
  })

  // ── 6. Get next version number ────────────────────────────
  const { count } = await supabaseAdmin
    .from('generated_outputs')
    .select('id', { count: 'exact', head: true })
    .eq('case_id', case_id)

  const version = (count || 0) + 1

  // ── 7. Call Claude ────────────────────────────────────────
  console.log(`[GEN] Calling Claude for case ${case_id} (version ${version}, demo: ${isDemo}, beweisfragen: ${caseRow.beweisfragen?.length || 0})`)

  let generatedText = ''

  try {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    const stream = anthropic.messages.stream({
      model: GENERATION_MODEL,
      max_tokens: 8000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    })

    stream.on('text', (text) => {
      generatedText += text
      res.write(`data: ${JSON.stringify({ type: 'text', text })}\n\n`)
    })

    const finalMsg = await stream.finalMessage()
    const inputTokens  = finalMsg.usage?.input_tokens  || 0
    const outputTokens = finalMsg.usage?.output_tokens || 0

    const { data: output, error: outputError } = await supabaseAdmin
      .from('generated_outputs')
      .insert({
        case_id,
        org_id: profile.org_id,
        created_by: profile.id,
        content_json: { text: generatedText },
        model_used: GENERATION_MODEL,
        version,
        is_demo: isDemo,
        output_status: 'draft',
        input_tokens:  inputTokens,
        output_tokens: outputTokens,
        prompt_snapshot: {
          system: systemPrompt,
          user: userPrompt,
          retrieved_chunks: retrievedChunks.length,
          template_id: template?.id || null,
          beweisfragen_count: caseRow.beweisfragen?.length || 0,
        },
      })
      .select('id, version, is_demo, created_at')
      .single()

    if (outputError) throw outputError

    await supabaseAdmin
      .from('cases')
      .update({ status: isDemo ? 'draft' : 'in_progress' })
      .eq('id', case_id)

    await supabaseAdmin.from('audit_log').insert({
      org_id: profile.org_id,
      user_id: req.user.id,
      action: isDemo ? 'output.demo_generated' : 'output.generated',
      entity_type: 'generated_outputs',
      entity_id: output.id,
      metadata: { version, retrieved_chunks: retrievedChunks.length },
    })

    res.write(`data: ${JSON.stringify({ type: 'done', output })}\n\n`)
    res.end()

    console.log(`[GEN] Completed case ${case_id}, output ${output.id} — ${inputTokens} in / ${outputTokens} out tokens`)

    // Increment per-case generation counter
    if (!isDemo) {
      incrementGenerationQuota(case_id).catch(err =>
        console.error('[QUOTA] Generation increment failed:', err.message)
      )
    }

  } catch (err) {
    console.error('[GEN] Generation failed:', err.message)
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Generation failed', message: err.message })
    }
    res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`)
    res.end()
  }
})


// GET /api/generate/output/:id
router.get('/output/:id', requireAuth, async (req, res) => {
  const profile = await getUserContext(req.user.id)
  if (!profile?.org_id) return res.status(404).json({ error: 'Not found' })

  const { data: output, error } = await supabaseAdmin
    .from('generated_outputs')
    .select(`
      id, content_json, model_used, version, is_demo, created_at,
      created_by ( full_name ),
      cases ( id, patient_ref, title )
    `)
    .eq('id', req.params.id)
    .eq('org_id', profile.org_id)
    .single()

  if (error || !output) return res.status(404).json({ error: 'Output not found' })
  res.json({ output })
})


// PATCH /api/generate/output/:id
router.patch('/output/:id', requireAuth, async (req, res) => {
  const { content_json, output_status, completed_at } = req.body
  if (!content_json) return res.status(400).json({ error: 'content_json is required' })

  const profile = await getUserContext(req.user.id)
  if (!profile?.org_id) return res.status(404).json({ error: 'Not found' })

  const updates = { content_json }
  if (output_status) updates.output_status = output_status
  if (completed_at)  updates.completed_at  = completed_at

  const { data: output, error } = await supabaseAdmin
    .from('generated_outputs')
    .update(updates)
    .eq('id', req.params.id)
    .eq('org_id', profile.org_id)
    .select('id, version, output_status, completed_at, created_at')
    .single()

  if (error || !output) return res.status(404).json({ error: 'Output not found' })
  res.json({ output })
})


// GET /api/generate/case/:caseId/outputs
router.get('/case/:caseId/outputs', requireAuth, async (req, res) => {
  const profile = await getUserContext(req.user.id)
  if (!profile?.org_id) return res.json({ outputs: [] })

  const { data: outputs, error } = await supabaseAdmin
    .from('generated_outputs')
    .select('id, version, is_demo, model_used, created_at, created_by ( full_name )')
    .eq('case_id', req.params.caseId)
    .eq('org_id', profile.org_id)
    .order('version', { ascending: false })

  if (error) throw error
  res.json({ outputs })
})

// GET /api/generate/output/:id/charcount
// Returns character count of the generated output text
router.get('/output/:id/charcount', requireAuth, async (req, res) => {
  const { data: output, error } = await supabaseAdmin
    .from('generated_outputs')
    .select('id, content_json, case_id')
    .eq('id', req.params.id)
    .single()

  if (error || !output) return res.status(404).json({ error: 'Output not found' })

  const text     = output.content_json?.text || ''
  const charCount = text.replace(/\s/g, '').length  // characters without whitespace
  const charCountWithSpaces = text.length             // characters with whitespace

  res.json({ char_count: charCount, char_count_with_spaces: charCountWithSpaces })
})


export default router