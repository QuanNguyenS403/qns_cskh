import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import crypto from 'node:crypto'
import { config } from './config/env.js'
import { getDb } from './db/connection.js'
import { runMigrations } from './db/migrations.js'
import { killSwitch } from './config/killSwitch.js'
import { handleMetaWebhookGet, handleMetaWebhookPost } from './channels/metaWebhook.js'
import { messengerAdapter } from './channels/messengerAdapter.js'
import { instagramAdapter } from './channels/instagramAdapter.js'
import { threadsAdapter } from './channels/threadsAdapter.js'
import { zaloAdapter } from './channels/zaloAdapter.js'
import { GoogleSheetsService } from './integrations/googleSheetsService.js'
import { eventGateway } from './events/eventGateway.js'
import { createRateLimiter } from './security/rateLimiter.js'

export function timingSafeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}

export function extractBearerToken(req) {
  const authHeader = req.headers['authorization'] || ''
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim()
  }
  if (authHeader.startsWith('ApiKey ') || authHeader.startsWith('Apikey ')) {
    return authHeader.slice(7).trim()
  }
  return authHeader.trim()
}

const app = express()

app.use(helmet())
app.use(cors({
  origin: (origin, callback) => {
    if (
      !origin ||
      config.NODE_ENV !== 'production' ||
      config.CORS_ORIGIN.includes(origin) ||
      origin.startsWith('chrome-extension://') ||
      origin.includes('facebook.com') ||
      origin.includes('instagram.com')
    ) {
      callback(null, true)
    } else {
      callback(new Error('Blocked by CORS policy'))
    }
  },
  credentials: true,
}))
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
// -- Ping endpoint cho Cron Job giu service khong ngu (Free Plan) -
// Dung cron-job.org hoac GitHub Actions GET /api/ping moi 10 phut
app.get('/api/ping', (req, res) => {
  res.json({ pong: true, uptime: Math.floor(process.uptime()), time: new Date().toISOString() })
})

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

import { PricingService } from './pricing/pricingService.js'
import { CATALOG, getProductBySkuOrSlug, searchCatalog } from './catalog/products.js'
import { seedDefaultPolicies, getAllApprovedPolicies } from './policies/policyRegistry.js'

// ── CATALOG & PRICING API (Blueprint §8, §9) ─────────────────
app.get('/api/catalog', (req, res) => {
  const { keyword, maxPrice, size } = req.query
  const results = searchCatalog({
    keyword: keyword || null,
    maxPrice: maxPrice ? parseInt(maxPrice, 10) : null,
    size: size || null,
  })
  return res.json({ success: true, count: results.length, products: results })
})

app.get('/api/catalog/:sku', (req, res) => {
  const product = getProductBySkuOrSlug(req.params.sku)
  if (!product) {
    return res.status(404).json({ success: false, error: 'Product not found' })
  }
  return res.json({ success: true, product })
})

app.post('/api/quote', (req, res) => {
  try {
    const db = getDb()
    const { items, paymentMethod, shippingProvince, promoCode } = req.body || {}
    const quoteEnvelope = PricingService.calculateQuote(db, {
      items,
      paymentMethod,
      shippingProvince,
      promoCode,
    })

    if (quoteEnvelope.status === 'REJECTED') {
      return res.status(400).json({ success: false, ...quoteEnvelope })
    }

    return res.json({ success: true, ...quoteEnvelope })
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message })
  }
})

app.get('/api/quote/:quoteId', (req, res) => {
  const db = getDb()
  const result = PricingService.getQuote(db, req.params.quoteId)
  if (!result || result.status === 'REJECTED') {
    return res.status(404).json({ success: false, ...result })
  }
  return res.json({ success: true, ...result })
})

app.get('/api/policies', (req, res) => {
  const db = getDb()
  const policies = getAllApprovedPolicies(db, 'quannguyens')
  return res.json({ success: true, policies })
})

import { OrderService } from './orders/orderService.js'

// ── ORDERS & TRANSACTIONAL API (Blueprint §10, §11, §12) ─────
app.post('/api/orders/prepare', apiLimiter, (req, res) => {
  try {
    const db = getDb()
    const result = OrderService.prepareOrder(db, req.body || {})
    if (result.status === 'REJECTED') {
      return res.status(400).json({ success: false, ...result })
    }
    return res.json({ success: true, ...result })
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message })
  }
})

app.post('/api/orders/commit', apiLimiter, (req, res) => {
  try {
    const db = getDb()
    const result = OrderService.commitOrder(db, req.body || {})
    if (result.status === 'REJECTED') {
      return res.status(400).json({ success: false, ...result })
    }
    return res.json({ success: true, ...result })
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message })
  }
})

app.get('/api/orders/status', apiLimiter, (req, res) => {
  try {
    const db = getDb()
    const { orderId, phone } = req.query
    const result = OrderService.getOrder(db, { orderId, customerPhone: phone })
    if (result.status === 'REJECTED') {
      const statusCode = result.error_code === 'FORBIDDEN_OBJECT_ACCESS' ? 403 : 400
      return res.status(statusCode).json({ success: false, ...result })
    }
    return res.json({ success: true, ...result })
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message })
  }
})

app.post('/api/payment/generate-qr', apiLimiter, (req, res) => {
  try {
    const db = getDb()
    const { orderId } = req.body || {}
    const result = OrderService.createPaymentRequest(db, { orderId })
    if (result.status === 'REJECTED') {
      return res.status(400).json({ success: false, ...result })
    }
    return res.json({ success: true, ...result })
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message })
  }
})

import { MayOrchestrator } from './agent/mayOrchestrator.js'

// ── QUANNGUYENS AI CSKH INTERACTION API (Blueprint §4, Phase 2, Co-Pilot RPA) ──────
app.post('/api/chat', apiLimiter, async (req, res) => {
  try {
    const db = getDb()
    const orchestrator = new MayOrchestrator(db)
    const {
      message,
      channel = 'copilot',
      senderId = 'copilot_agent',
      conversationState = {},
      isCopilot = true,
      customerName = null,
    } = req.body || {}
    
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ success: false, error: 'Tham số message là bắt buộc' })
    }

    if (customerName) {
      conversationState.customerName = customerName
    }

    const response = await orchestrator.processMessage({
      text: message,
      channel,
      senderId,
      conversationState,
      isCopilot,
    })

    return res.json({ success: true, ...response })
  } catch (err) {
    console.error('Lỗi xử lý chat QuanNguyenS:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
})

// ── META PLATFORM WEBHOOK (Messenger, Instagram, Threads) ────
app.get('/api/webhook/meta', handleMetaWebhookGet)
app.post('/api/webhook/meta', webhookLimiter, async (req, res) => {
  await handleMetaWebhookPost(req, res, async (inboundMessage) => {
    console.log(`📩 [INBOUND OMNICHANNEL] Từ ${inboundMessage.channel} (${inboundMessage.channelSenderId}): "${inboundMessage.text}"`)
    try {
      const db = getDb()

      // Sự kiện Meta Webhook đã được khử trùng lặp an toàn tại handleMetaWebhookPost

      const orchestrator = new MayOrchestrator(db)
      const agentResponse = await orchestrator.processMessage({
        text: inboundMessage.text,
        channel: inboundMessage.channel,
        senderId: inboundMessage.channelSenderId,
        providerMessageId: inboundMessage.messageId,
      })

      if (!agentResponse || !agentResponse.customer_message) {
        return
      }

      // Gửi phản hồi qua adapter tương ứng có can_send bảo vệ
      const lastCustomerInteractionAt = inboundMessage.occurredAt || new Date().toISOString()
      if (inboundMessage.channel === 'messenger') {
        await messengerAdapter.sendMessage({ recipientId: inboundMessage.channelSenderId, text: agentResponse.customer_message, lastCustomerInteractionAt })
      } else if (inboundMessage.channel === 'instagram') {
        await instagramAdapter.sendMessage({ recipientId: inboundMessage.channelSenderId, text: agentResponse.customer_message, lastCustomerInteractionAt })
      } else if (inboundMessage.channel === 'threads') {
        await threadsAdapter.replyToPost({ postId: inboundMessage.channelSenderId, text: agentResponse.customer_message })
      }
    } catch (e) {
      console.error(`❌ [QUANNGUYENS DISPATCH ERROR ${inboundMessage.channel}]:`, e.message)
    }
  })
})

// ── ZALO OA PLATFORM WEBHOOK ─────────────────────────────────
app.get('/api/webhook/zalo', (req, res) => {
  return res.send(req.query.challenge || 'OK')
})

app.post('/api/webhook/zalo', webhookLimiter, async (req, res) => {
  try {
    // Xác thực chữ ký Zalo (C4)
    if (config.ZALO_SECRET_KEY) {
      const signature = req.headers['x-zevent-signature'] || req.headers['mac'] || ''
      const rawBody = req.rawBody || JSON.stringify(req.body)
      const isValid = eventGateway.verifySignature(rawBody, signature, config.ZALO_SECRET_KEY)
      if (!isValid) {
        return res.status(401).json({ success: false, error: 'Unauthorized Zalo Webhook signature' })
      }
    }

    const inbound = zaloAdapter.parseInboundEvent(req.body)
    if (!inbound) {
      return res.json({ success: true, ignored: true })
    }

    // Chống trùng lặp sự kiện Zalo (H13)
    const ingestRes = eventGateway.ingestEvent({
      eventId: inbound.messageId,
      source: 'zalo',
      eventType: 'message.received',
      entityType: 'customer',
      entityId: inbound.channelSenderId,
      payload: inbound,
    })

    if (ingestRes.isDuplicate) {
      return res.json({ success: true, message: 'Duplicate Zalo event ignored' })
    }

    console.log(`📩 [INBOUND ZALO OA] Từ ${inbound.channelSenderId}: "${inbound.text}"`)
    const db = getDb()
    const orchestrator = new MayOrchestrator(db)
    const agentResponse = await orchestrator.processMessage({
      text: inbound.text,
      channel: 'zalo',
      senderId: inbound.channelSenderId,
      providerMessageId: inbound.messageId,
    })

    if (agentResponse.customer_message) {
      await zaloAdapter.sendTextMessage({
        recipientId: inbound.channelSenderId,
        text: agentResponse.customer_message,
      })
    }

    return res.json({ success: true, status: 'PROCESSED' })
  } catch (err) {
    console.error(`❌ [ZALO WEBHOOK ERROR]:`, err.message)
    return res.status(500).json({ success: false, error: 'Lỗi xử lý Zalo webhook' })
  }
})

// ── SEPAY / BANK PAYMENT WEBHOOK (C1, B08, T13) ──────────────
app.post('/api/webhook/sepay', webhookLimiter, async (req, res) => {
  try {
    const rawAuth = extractBearerToken(req) || req.headers['x-api-key'] || ''
    const expectedSecret = config.SEPAY_WEBHOOK_API_KEY

    // Bắt buộc xác thực hằng-thời-gian, không bao giờ bypass khi thiếu key (C1)
    if (!expectedSecret || !timingSafeCompare(rawAuth, expectedSecret)) {
      return res.status(401).json({ success: false, error: 'Unauthorized payment webhook' })
    }

    const payload = req.body || {}
    const rawTxId = payload.id || payload.referenceCode
    if (!rawTxId) {
      return res.status(400).json({ success: false, error: 'Thiếu mã giao dịch thanh toán bắt buộc (id/referenceCode)' })
    }
    const txId = String(rawTxId)

    // Kiểm tra chiều dòng tiền: từ chối giao dịch chuyển tiền đi (outbound)
    const isOutbound = payload.transferType === 'out' || (payload.amountOut && Number(payload.amountOut) > 0 && !payload.amountIn)
    if (isOutbound) {
      return res.status(400).json({ success: false, error: 'Giao dịch chuyển tiền đi không thể đối soát thanh toán đơn hàng' })
    }

    // Kiểm tra tài khoản nhận nếu có
    const targetAccount = String(payload.accountNumber || payload.subAccount || '').trim()
    if (targetAccount && config.VIETQR_ACCOUNT_NO && targetAccount !== String(config.VIETQR_ACCOUNT_NO).trim()) {
      return res.status(400).json({ success: false, error: 'Tài khoản nhận giao dịch không khớp với cấu hình của shop' })
    }

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

    // Đối soát tự động với đơn hàng nếu có mã đơn trong nội dung chuyển khoản
    const content = String(payload.content || payload.description || '')
    const orderMatch = content.match(/QNS[- ]?[A-Z0-9]{6}[- ]?[A-Z0-9]{4}/i)
    let orderId = payload.orderId || null
    if (!orderId && orderMatch) {
      orderId = orderMatch[0].replace(/\s+/g, '-').toUpperCase()
    }

    const db = getDb()
    const reconcileRes = OrderService.reconcilePayment(db, {
      orderId,
      gateway: 'sepay',
      transactionId: txId,
      amount: payload.amountIn || payload.transferAmount || payload.amount || 0,
      targetAccount,
      rawPayload: payload,
    })

    return res.json({ success: true, message: 'Đã tiếp nhận và đối soát giao dịch', eventId: txId, reconcile: reconcileRes })
  } catch (err) {
    console.error('SePay webhook error:', err)
    return res.status(500).json({ success: false, error: 'Lỗi xử lý webhook thanh toán' })
  }
})

// ── GOOGLE SHEETS LIVE ORDER CONFIRMATION WEBHOOK (C3) ───────
app.post('/api/webhook/google-sheets', webhookLimiter, async (req, res) => {
  try {
    const rawSecret = extractBearerToken(req) || req.headers['x-sheets-secret'] || req.body?.secret || ''
    const expectedSecret = config.GOOGLE_SHEET_WEBHOOK_SECRET

    // Bắt buộc xác thực bí mật hằng-thời-gian (C3)
    if (!expectedSecret || !timingSafeCompare(rawSecret, expectedSecret)) {
      return res.status(401).json({ success: false, error: 'Unauthorized: Sai hoặc thiếu Google Sheet Webhook Secret' })
    }

    const {
      orderId,
      customerName,
      customerPhone,
      items,
      channel = 'messenger',
      channelSenderId,
      carrier = 'Viettel Post',
      trackingCode,
      confirmedBy = 'Chủ shop (Google Sheet)',
    } = req.body || {}

    if (!orderId) {
      return res.status(400).json({ success: false, error: 'Thiếu mã đơn hàng (orderId)' })
    }

    const db = getDb()
    const result = await GoogleSheetsService.handleDeliveryConfirmation(db, {
      orderId,
      customerName,
      customerPhone,
      items,
      channel,
      channelSenderId,
      carrier,
      trackingCode,
      confirmedBy,
    })

    if (result.status === 'REJECTED' && result.error_code === 'ORDER_NOT_FOUND') {
      return res.status(404).json({ success: false, ...result })
    }

    return res.json({ success: true, ...result })
  } catch (err) {
    console.error('❌ [GOOGLE SHEETS WEBHOOK ERROR]:', err.message)
    return res.status(500).json({ success: false, error: 'Lỗi xử lý webhook Google Sheets' })
  }
})

// ── ADMIN KILL SWITCH CONTROL (C2: Auth Header + Durable SQLite) ──
function verifyAdmin(req) {
  const token = extractBearerToken(req) || req.headers['x-admin-secret'] || (req.body && req.body.secret) || ''
  if (!config.ADMIN_SECRET || !token) return false
  return timingSafeCompare(token, config.ADMIN_SECRET)
}

app.get('/api/admin/killswitch', (req, res) => {
  if (!verifyAdmin(req)) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Admin Secret required' })
  }
  return res.json(killSwitch.getStatus())
})

app.post('/api/admin/killswitch', (req, res) => {
  if (!verifyAdmin(req)) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Invalid Admin Secret' })
  }

  const { level, target, state, reason } = req.body || {}
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

// Khởi tạo Database Migration và Dữ liệu Chính sách mặc định khi khởi chạy (H9: Fail-closed)
try {
  const db = getDb()
  runMigrations(db)
  killSwitch.init(db)
  seedDefaultPolicies(db, config.DEFAULT_SHOP_ID, true)
  if (config.GOOGLE_SHEET_AUTO_SYNC && config.NODE_ENV !== 'test' && !process.env.NODE_TEST_CONTEXT) {
    GoogleSheetsService.startPoller(db)
  }
  console.log('✅ [CSKH DB] Cơ sở dữ liệu, Migration & Chính sách đã sẵn sàng.')
} catch (e) {
  console.error('🚨 [FATAL STARTUP ERROR] Khởi tạo DB/Migration thất bại:', e.message)
  if (!process.env.SUPPRESS_STARTUP_EXIT) {
    process.exit(1)
  }
}

import { fileURLToPath } from 'url'
import path from 'path'

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])

if (isMain) {
  app.listen(config.PORT, '0.0.0.0', () => {
    console.log(`\n======================================================`)
    console.log(`🤖 QUANNGUYENS AI CSKH PRODUCTION GATEWAY`)
    console.log(`   Base URL:       http://localhost:${config.PORT}`)
    console.log(`   Health Check:   http://localhost:${config.PORT}/api/health`)
    console.log(`   Chat API:       http://localhost:${config.PORT}/api/chat`)
    console.log(`   Meta Webhook:   http://localhost:${config.PORT}/api/webhook/meta`)
    console.log(`   Zalo Webhook:   http://localhost:${config.PORT}/api/webhook/zalo`)
    console.log(`   Sheets Webhook: http://localhost:${config.PORT}/api/webhook/google-sheets`)
    console.log(`   SePay Webhook:  http://localhost:${config.PORT}/api/webhook/sepay`)
    console.log(`   Environment:    ${config.NODE_ENV.toUpperCase()}`)
    console.log(`   Outbound:       ${config.OUTBOUND_ENABLED ? 'ENABLED (24/7 Automation)' : 'STANDBY'}`)
    console.log(`======================================================\n`)
  })
}

export default app
