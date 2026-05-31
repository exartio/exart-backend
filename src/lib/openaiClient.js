import OpenAI from 'openai'

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

// Embedding model — 1536 dimensions, matches vector(1536) in Supabase schema
export const EMBEDDING_MODEL = 'text-embedding-3-small'

// Generate a single embedding vector for a text string
export async function embed(text) {
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
    encoding_format: 'float',
  })
  return response.data[0].embedding
}

// Generate embeddings for multiple texts in one API call (more efficient)
export async function embedBatch(texts) {
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
    encoding_format: 'float',
  })
  return response.data.map(d => d.embedding)
}
