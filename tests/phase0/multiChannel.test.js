import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import { DatabaseSync } from 'node:sqlite'
import { runMigrations } from '../../src/db/migrations.js'
import { CanSendGate } from '../../src/channels/canSend.js'
import { messengerAdapter } from '../../src/channels/messengerAdapter.js'
import { instagramAdapter } from '../../src/channels/instagramAdapter.js'
import { threadsAdapter } from '../../src/channels/threadsAdapter.js'
import { zaloAdapter } from '../../src/channels/zaloAdapter.js'
import { handleMetaWebhookGet, handleMetaWebhookPost } from '../../src/channels/metaWebhook.js'

test('Phase 0 & Multi-Channel - can_send Runtime & Channel Gate Checks', async (t) => {
  const testDbPath = path.resolve('data/test_channels.db')
  fs.mkdirSync(path.dirname(testDbPath), { recursive: true })
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath)
  }

  const db = new DatabaseSync(testDbPath)
  runMigrations(db)
  const canSend = new CanSendGate(db)

  // 1. Chặn cứng các Tag Messenger đã ngừng (B12 requirement)
  const tagCheck = canSend.evaluate({
    customerId: 'cust_fb_1',
    channel: 'messenger',
    messageType: 'transactional',
    metaMessageTag: 'POST_PURCHASE_UPDATE',
  })
  assert.strictEqual(tagCheck.decision, 'DENY')
  assert.strictEqual(tagCheck.reasonCode, 'RETIRED_META_TAG_BLOCKED')

  // 2. Chặn bot mượn HUMAN_AGENT (B12 requirement)
  const humanAgentCheck = canSend.evaluate({
    customerId: 'cust_fb_1',
    channel: 'messenger',
    messageType: 'support',
    isHumanAgent: true,
  })
  assert.strictEqual(humanAgentCheck.decision, 'DENY')
  assert.strictEqual(humanAgentCheck.reasonCode, 'BOT_CANNOT_USE_HUMAN_AGENT')

  // 3. Cửa sổ 24 giờ của Messenger / Instagram
  const now = new Date('2026-10-22T14:00:00+07:00')
  const interaction25hAgo = new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString()
  const interaction2hAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString()

  // Quá 24h -> DENY
  const windowExpired = canSend.evaluate({
    customerId: 'cust_fb_1',
    channel: 'messenger',
    messageType: 'support',
    lastCustomerInteractionAt: interaction25hAgo,
    now,
  })
  assert.strictEqual(windowExpired.decision, 'DENY')
  assert.strictEqual(windowExpired.reasonCode, 'OUTSIDE_24H_WINDOW')

  // Trong 24h -> ALLOW
  const windowValid = canSend.evaluate({
    customerId: 'cust_fb_1',
    channel: 'messenger',
    messageType: 'support',
    lastCustomerInteractionAt: interaction2hAgo,
    now,
  })
  assert.strictEqual(windowValid.decision, 'ALLOW')

  // 4. Suppression Rule: Case khiếu nại đang mở -> Chặn tiếp thị marketing
  db.prepare(`
    INSERT INTO cases (
      id, tenant_id, shop_id, customer_id, issue_type, priority, status, summary,
      created_at, updated_at
    ) VALUES (
      'case_defect_001', 'quannguyens_corp', 'quannguyens_pijama',
      'cust_complaint_9', 'defect', 'P1', 'INVESTIGATING', 'Áo bị sờn chỉ viền',
      datetime('now'), datetime('now')
    )
  `).run()

  const suppressedMarketing = canSend.evaluate({
    customerId: 'cust_complaint_9',
    channel: 'web',
    messageType: 'marketing',
    now,
  })
  assert.strictEqual(suppressedMarketing.decision, 'DENY')
  assert.strictEqual(suppressedMarketing.reasonCode, 'SUPPRESSED_DUE_TO_OPEN_CASE')

  // 5. Opt-Out: Khách đã từ chối nhận tiếp thị
  db.prepare(`
    INSERT INTO consents (
      id, tenant_id, shop_id, customer_id, purpose, channel, status, evidence_type,
      version, recorded_at
    ) VALUES (
      'consent_revoked_1', 'quannguyens_corp', 'quannguyens_pijama',
      'cust_optout_3', 'marketing', 'messenger', 'REVOKED', 'customer_message',
      '1.0', datetime('now')
    )
  `).run()

  const optOutCheck = canSend.evaluate({
    customerId: 'cust_optout_3',
    channel: 'messenger',
    messageType: 'marketing',
    lastCustomerInteractionAt: interaction2hAgo,
    now,
  })
  assert.strictEqual(optOutCheck.decision, 'DENY')
  assert.strictEqual(optOutCheck.reasonCode, 'CUSTOMER_OPTED_OUT')

  // 6. Quiet Hours: Đêm 22:30 -> Dời lịch gửi (DEFER)
  const nightTime = new Date('2026-10-22T22:30:00+07:00')
  const quietCheck = canSend.evaluate({
    customerId: 'cust_normal_1',
    channel: 'web',
    messageType: 'marketing',
    now: nightTime,
  })
  assert.strictEqual(quietCheck.decision, 'DEFER')
  assert.strictEqual(quietCheck.reasonCode, 'QUIET_HOURS')

  // 7. Test Meta Webhook Verification (hub.mode = subscribe)
  let verifyStatus = 0
  let verifyBody = ''
  const mockReqGet = {
    query: {
      'hub.mode': 'subscribe',
      'hub.verify_token': 'quannguyens_meta_verify_token_2026',
      'hub.challenge': 'CHALLENGE_ACCEPTED_777',
    },
  }
  const mockResGet = {
    status(s) { verifyStatus = s; return this },
    send(b) { verifyBody = b; return this },
  }
  handleMetaWebhookGet(mockReqGet, mockResGet)
  assert.strictEqual(verifyStatus, 200)
  assert.strictEqual(verifyBody, 'CHALLENGE_ACCEPTED_777')

  // 8. Test Mock Send qua các Adapter
  const msgRes = await messengerAdapter.sendMessage({
    recipientId: 'user_123',
    text: 'Chào bạn, May có thể hỗ trợ gì cho bạn?',
    lastCustomerInteractionAt: interaction2hAgo,
  })
  assert.strictEqual(msgRes.sent, true)

  const igRes = await instagramAdapter.sendMessage({
    recipientId: 'ig_user_456',
    text: 'Dạ mẫu The Daybreak Set có sẵn size M ạ',
    lastCustomerInteractionAt: interaction2hAgo,
  })
  assert.strictEqual(igRes.sent, true)

  const thRes = await threadsAdapter.replyToThread({
    replyToThreadId: 'thread_post_789',
    text: 'QuanNguyenS may bằng sợi tự nhiên 165 GSM bạn nhé!',
  })
  assert.strictEqual(thRes.sent, true)

  const zaloRes = await zaloAdapter.sendTemplateMessage({
    recipientId: 'zalo_user_999',
    templateId: 'tpl_order_confirmed_01',
    templateData: { orderId: 'QNS-123' },
  })
  assert.strictEqual(zaloRes.sent, true)

  db.close()
  try {
    fs.unlinkSync(testDbPath)
    if (fs.existsSync(`${testDbPath}-wal`)) fs.unlinkSync(`${testDbPath}-wal`)
    if (fs.existsSync(`${testDbPath}-shm`)) fs.unlinkSync(`${testDbPath}-shm`)
  } catch {}
})
