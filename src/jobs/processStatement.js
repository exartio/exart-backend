import { supabaseAdmin } from '../lib/supabase.js'
import { embedBatch } from '../lib/openaiClient.js'
import { extractText, chunkText } from '../lib/textExtraction.js'

// Process a past_statement record:
// 1. Download file from Supabase Storage
// 2. Extract text
// 3. Chunk text
// 4. Embed all chunks in batches
// 5. Store embeddings in statement_embeddings
// 6. Update statement status

export async function processStatement(statementId) {
  console.log(`[RAG] Starting ingestion for statement ${statementId}`)

  // Mark as processing
  await supabaseAdmin
    .from('past_statements')
    .update({ status: 'processing' })
    .eq('id', statementId)

  try {
    // Fetch the statement record
    const { data: statement, error: fetchError } = await supabaseAdmin
      .from('past_statements')
      .select('id, org_id, file_name, storage_path')
      .eq('id', statementId)
      .single()

    if (fetchError || !statement) {
      throw new Error(`Statement not found: ${statementId}`)
    }

    // Download file from Supabase Storage
    const { data: fileData, error: downloadError } = await supabaseAdmin.storage
      .from('past-statements')
      .download(statement.storage_path)

    if (downloadError || !fileData) {
      throw new Error(`Failed to download file: ${downloadError?.message}`)
    }

    const buffer = Buffer.from(await fileData.arrayBuffer())

    // Determine MIME type from file extension
    const mimeType = getMimeTypeFromFilename(statement.file_name)

    // Extract text
    console.log(`[RAG] Extracting text from ${statement.file_name}`)
    const text = await extractText(buffer, mimeType, statement.file_name)

    if (!text || text.length < 100) {
      throw new Error('Extracted text too short — file may be empty or unreadable')
    }

    console.log(`[RAG] Extracted ${text.length} characters, chunking...`)

    // Chunk the text
    const chunks = chunkText(text, 1000, 150)
    console.log(`[RAG] Created ${chunks.length} chunks, embedding...`)

    // Delete any existing embeddings for this statement (re-processing case)
    await supabaseAdmin
      .from('statement_embeddings')
      .delete()
      .eq('statement_id', statementId)

    // Embed in batches of 20 (OpenAI batch limit is much higher, but this keeps memory low)
    const BATCH_SIZE = 20
    let chunkIndex = 0

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE)
      const embeddings = await embedBatch(batch)

      const rows = batch.map((chunk, j) => ({
        statement_id: statementId,
        org_id: statement.org_id,
        chunk_text: chunk,
        embedding: JSON.stringify(embeddings[j]), // Supabase expects JSON array for vector
        chunk_index: chunkIndex + j,
      }))

      const { error: insertError } = await supabaseAdmin
        .from('statement_embeddings')
        .insert(rows)

      if (insertError) throw new Error(`Failed to insert embeddings: ${insertError.message}`)

      chunkIndex += batch.length
      console.log(`[RAG] Embedded ${Math.min(i + BATCH_SIZE, chunks.length)}/${chunks.length} chunks`)
    }

    // Mark as ready
    await supabaseAdmin
      .from('past_statements')
      .update({ status: 'ready', error_message: null })
      .eq('id', statementId)

    console.log(`[RAG] Completed ingestion for statement ${statementId} — ${chunks.length} chunks stored`)

  } catch (err) {
    console.error(`[RAG] Failed to process statement ${statementId}:`, err.message)

    await supabaseAdmin
      .from('past_statements')
      .update({ status: 'error', error_message: err.message })
      .eq('id', statementId)
  }
}


// Retrieve the most relevant statement chunks for a given query
// Used in Phase 3 when building the generation prompt
export async function retrieveRelevantChunks(orgId, queryText, limit = 8) {
  const { embed } = await import('../lib/openaiClient.js')
  const queryEmbedding = await embed(queryText)

  // pgvector cosine similarity search via Supabase RPC
  const { data, error } = await supabaseAdmin.rpc('match_statement_chunks', {
    p_org_id: orgId,
    p_query_embedding: JSON.stringify(queryEmbedding),
    p_match_count: limit,
    p_match_threshold: 0.75, // minimum similarity score (0-1)
  })

  if (error) throw new Error(`Retrieval failed: ${error.message}`)
  return data || []
}

function getMimeTypeFromFilename(filename) {
  const ext = filename.split('.').pop()?.toLowerCase()
  const map = {
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    txt: 'text/plain',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
  }
  return map[ext] || 'application/octet-stream'
}
