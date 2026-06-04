import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import stripeRouter from './routes/stripe.js'
import orgsRouter from './routes/orgs.js'
import uploadsRouter from './routes/uploads.js'
import casesRouter from './routes/cases.js'
import verificationRouter from './routes/verification.js'
import referralRouter from './routes/referral.js'
import abrechnungRouter from './routes/abrechnung.js'
import adminRouter  from './routes/admin-metrics.js'
import authWebhook  from './routes/auth-webhook.js'
import invitationsRouter from './routes/invitations.js'
import exportArchiveRouter from './routes/exportArchive.js'
import { runDeadlineReminders } from './jobs/deadlineReminder.js'
import generateRouter from './routes/generate.js'
import exportRouter from './routes/export.js'
import profileRouter from './routes/profile.js'
import subscriptionsRouter from './routes/subscriptions.js'
import templatesRouter from './routes/templates.js'

// ── Catch unhandled rejections before they crash the process ──
process.on('unhandledRejection', (reason, promise) => {
  console.error('=== UNHANDLED REJECTION ===')
  console.error('Promise:', promise)
  console.error('Reason:', JSON.stringify(reason, null, 2))
  console.error('Reason (raw):', reason)
  console.error('===========================')
})

process.on('uncaughtException', (err) => {
  console.error('=== UNCAUGHT EXCEPTION ===')
  console.error(err)
  console.error('==========================')
})

const app = express()

// CORS
app.use(cors({
  origin: [
    process.env.FRONTEND_URL || 'https://exart.io',
    'https://exart.io',
    'https://www.exart.io',
    'https://exart-io.webflow.io', // keep during domain transition
    'http://localhost:3000',
  ],
  credentials: true,
}))

// Stripe webhook MUST be registered before express.json()
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }))

// JSON body parsing
app.use(express.json())

// Routes
app.use('/api/stripe',         stripeRouter)
app.use('/api/orgs',           orgsRouter)
app.use('/api/uploads',        uploadsRouter)
app.use('/api/cases',          casesRouter)
app.use('/api/verification',   verificationRouter)
app.use('/api/referral',        referralRouter)
app.use('/api/abrechnung',      abrechnungRouter)
app.use('/api/admin',           adminRouter)
app.use('/api/webhooks/auth',    authWebhook)
app.use('/api/invitations',     invitationsRouter)
app.use('/api/export-archive',  exportArchiveRouter)
app.use('/api/generate',       generateRouter)
app.use('/api/export',         exportRouter)
app.use('/api/profile',        profileRouter)
app.use('/api/account',        profileRouter)
app.use('/api/subscriptions',  subscriptionsRouter)
app.use('/api/templates',      templatesRouter)

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

  // Daily deadline reminder — runs at 08:00 server time
  function scheduleDailyReminder() {
    const now  = new Date()
    const next = new Date(now)
    next.setHours(8, 0, 0, 0)
    if (next <= now) next.setDate(next.getDate() + 1)
    const msUntil = next - now
    console.log(`[DEADLINE] Next reminder check in ${Math.round(msUntil / 60000)} minutes`)
    setTimeout(() => {
      runDeadlineReminders().catch(err => console.error('[DEADLINE] Error:', err.message))
      setInterval(() => {
        runDeadlineReminders().catch(err => console.error('[DEADLINE] Error:', err.message))
      }, 24 * 60 * 60 * 1000)
    }, msUntil)
  }

  scheduleDailyReminder()
})