import 'dotenv/config'
import express from 'express'
import cors from 'cors'

import stripeRouter from './routes/stripe.js'
import orgsRouter from './routes/orgs.js'
import uploadsRouter from './routes/uploads.js'
import casesRouter from './routes/cases.js'
import verificationRouter from './routes/verification.js'
import generateRouter from './routes/generate.js'
import exportRouter from './routes/export.js'

const app = express()

// CORS
app.use(cors({
  origin: [
    process.env.FRONTEND_URL,
    'http://localhost:3001',
  ],
  credentials: true,
}))

// Stripe webhook MUST be registered before express.json()
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }))

// JSON body parsing
app.use(express.json())

// Routes
app.use('/api/stripe', stripeRouter)
app.use('/api/orgs', orgsRouter)
app.use('/api/uploads', uploadsRouter)
app.use('/api/cases', casesRouter)
app.use('/api/verification', verificationRouter)
app.use('/api/generate', generateRouter)
app.use('/api/export', exportRouter)

// Health check
app.get('/health', (req, res) => res.json({ ok: true }))

// Global error handler
app.use((err, req, res, next) => {
  console.error(err)
  if (err.message === 'Unsupported file type') {
    return res.status(415).json({ error: err.message })
  }
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File too large. Maximum 20 MB.' })
  }
  res.status(500).json({ error: 'Internal server error' })
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`exart.io API running on port ${PORT}`)
})
