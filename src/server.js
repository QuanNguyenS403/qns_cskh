import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { config } from './config/env.js'
import { getDb } from './db/connection.js'
import { runMigrations } from './db/migrations.js'
import { killSwitch } from './config/killSwitch.js'
import { handleMetaWebhookGet, handleMetaWebhookPost } from './channels/metaWebhook.js'
import { eventGateway } from './events/eventGateway.js'
import { createRateLimiter } from './security/rateLimiter.js'

const app = express()

app.use(helmet())
app.use(cors())
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString()
  }
}))

// Rate Limiters
const webhookLimiter = createRateLimiter({ windowMs: 60000, max: 120, message: 'Too many webhook requests' })
const apiLimiter = createRateLimiter({ windowMs: 60000, max: 60, message: 'Rate limit exceeded' })

// ── Health & Readiness ──────────────────────────────────────
app.get('/livez', (req, res) => res.json({ status: 'alive', time: new Date().toISOString() }))

app.get('/readyz', (req, res) => {
  try {
    const db = getDb()
    db.prepare('SELECT 1').get()
    return res.json({ status: 'ready', db: 'connected', time: new Date().toISOString() })
  } catch (err) {
    return res.status(503).json({ status: 'not_ready', error: err.message })
  }
})

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'QuanNguyenS AI CSKH Action Gateway',
    version: '1.0.0',
    killSwitch: killSwitch.getStatus(),
    timezone: config.TIMEZONE,
    timestamp: new Date().toISOString(),
  })
})

// ── META PLATFORM WEBHOOK (Messenger, Instagram, Threads) ────
app.get('/api/webhook/meta', handleMetaWebhookGet)
app.post('/api/webhook/meta', webhookLimiter, async (req, res) => {
  await handleMetaWebhookPost(req, res, async (inboundMessage) => {
    console.log(`📩 [INBOUND OMNICHANNEL] Từ ${inboundMessage.channel} (${inboundMessage.channelSenderId}): "${inboundMessage.text}"`)
    // Điểm kết nối điều phối tới May Agent Orchestrator (Phase 2)
  })
})

// ── SEPAY / BANK PAYMENT WEBHOOK ─────────────────────────────
app.post('/api/webhook/sepay', webhookLimiter, async (req, res) => {
  try {
    const rawAuth = req.headers['authorization'] || req.headers['x-api-key'] || ''
    const expectedSecret = process.env.SEPAY_WEBHOOK_API_KEY
    if (expectedSecret && !rawAuth.includes(expectedSecret)) {
      return res.status(401).json({ success: false, error: 'Unauthorized payment webhook' })
    }

    const payload = req.body || {}
    const txId = String(payload.id || payload.referenceCode || Date.now())

    const ingestRes = eventGateway.ingestEvent({
      eventId: txId,
      source: 'sepay',
      eventType: 'payment.received',
      entityType: 'payment',
      entityId: txId,
      payload,
    })

    if (ingestRes.isDuplicate) {
      return res.json({ success: true, message: 'Giao dịch đã được ghi nhận trước đó (Idempotent)' })
    }

    return res.json({ success: true, message: 'Đã tiếp nhận giao dịch an toàn', eventId: txId })
  } catch (err) {
    console.error('SePay webhook error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

// ── ADMIN KILL SWITCH CONTROL ────────────────────────────────
app.get('/api/admin/killswitch', (req, res) => {
  return res.json(killSwitch.getStatus())
})

app.post('/api/admin/killswitch', (req, res) => {
  const { secret, level, target, state, reason } = req.body || {}
  if (secret !== config.ADMIN_SECRET) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Invalid Admin Secret' })
  }

  if (level === 'global') {
    killSwitch.setGlobalKill(state, reason)
  } else if (level === 'action') {
    killSwitch.setActionState(target, state, reason)
  } else if (level === 'channel') {
    killSwitch.setChannelState(target, state, reason)
  } else {
    return res.status(400).json({ success: false, error: 'Level phải là global, action, hoặc channel' })
  }

  return res.json({ success: true, status: killSwitch.getStatus() })
})

// Khởi tạo Database Migration khi khởi chạy
try {
  const db = getDb()
  runMigrations(db)
  console.log('✅ [CSKH DB] Cơ sở dữ liệu và Migration đã sẵn sàng.')
} catch (e) {
  console.error('❌ [CSKH DB ERROR]:', e.message)
}

import { fileURLToPath } from 'url'
import path from 'path'

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])

if (isMain) {
  app.listen(config.PORT, '0.0.0.0', () => {
    console.log(`\n======================================================`)
    console.log(`🤖 QuanNguyenS AI CSKH Gateway running on: http://localhost:${config.PORT}`)
    console.log(`   Meta Webhook: http://localhost:${config.PORT}/api/webhook/meta`)
    console.log(`   Health Check: http://localhost:${config.PORT}/api/health`)
    console.log(`======================================================\n`)
  })
}

export default app
