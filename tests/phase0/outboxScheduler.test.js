import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import { DatabaseSync } from 'node:sqlite'
import { runMigrations } from '../../src/db/migrations.js'
import { OutboxService } from '../../src/queue/outbox.js'
import { SchedulerService } from '../../src/queue/scheduler.js'
import { generateConfirmationToken, verifyConfirmationToken } from '../../src/security/tokenService.js'

test('Phase 0 - Outbox, Scheduler Lease & Confirmation Token Integrity', (t) => {
  const testDbPath = path.resolve('data/test_outbox.db')
  fs.mkdirSync(path.dirname(testDbPath), { recursive: true })
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath)
  }

  const db = new DatabaseSync(testDbPath)
  runMigrations(db)
  const outbox = new OutboxService(db)
  const scheduler = new SchedulerService(db)

  // 1. Test Confirmation Token (Gắn payload + version + TTL)
  const payload = {
    orderId: 'QNS-ORDER-123',
    sku: 'the-classic-set',
    size: 'M',
    total: 390000,
  }

  const token = generateConfirmationToken({
    customerId: 'cust_001',
    actionType: 'commit_order',
    targetId: 'QNS-ORDER-123',
    targetVersion: 1,
    payload,
    ttlSeconds: 60,
  })

  // Token hợp lệ với đúng action và payload
  const verifyRes = verifyConfirmationToken({
    token,
    expectedAction: 'commit_order',
    currentPayload: payload,
    consume: false,
  })
  assert.strictEqual(verifyRes.valid, true)

  // Token bị từ chối nếu payload bị sửa đổi (Anti-Tampering)
  const tamperedPayload = { ...payload, total: 350000 }
  const tamperRes = verifyConfirmationToken({
    token,
    expectedAction: 'commit_order',
    currentPayload: tamperedPayload,
    consume: false,
  })
  assert.strictEqual(tamperRes.valid, false)
  assert.strictEqual(tamperRes.code, 'PAYLOAD_MUTATED')

  // Token bị từ chối nếu sai action
  const actionRes = verifyConfirmationToken({
    token,
    expectedAction: 'refund',
    currentPayload: payload,
    consume: false,
  })
  assert.strictEqual(actionRes.valid, false)
  assert.strictEqual(actionRes.code, 'ACTION_MISMATCH')

  // Token tiêu thụ 1 lần (Single-use)
  const consumeRes1 = verifyConfirmationToken({
    token,
    expectedAction: 'commit_order',
    currentPayload: payload,
    consume: true,
  })
  assert.strictEqual(consumeRes1.valid, true)

  const consumeRes2 = verifyConfirmationToken({
    token,
    expectedAction: 'commit_order',
    currentPayload: payload,
    consume: true,
  })
  assert.strictEqual(consumeRes2.valid, false)
  assert.strictEqual(consumeRes2.code, 'ALREADY_CONSUMED')

  // 2. Test Outbox Enqueue & Idempotency
  const outboxRes1 = outbox.enqueueMessage({
    channel: 'web',
    recipientId: 'cust_001',
    messageType: 'transactional',
    content: { text: 'Đơn hàng đã được xác nhận' },
    idempotencyKey: 'msg_confirm_order_123',
  })
  assert.strictEqual(outboxRes1.success, true)
  assert.strictEqual(outboxRes1.isDuplicate, undefined)

  // Enqueue lại với cùng idempotencyKey: Phải trả về bản ghi cũ, không tạo trùng
  const outboxRes2 = outbox.enqueueMessage({
    channel: 'web',
    recipientId: 'cust_001',
    messageType: 'transactional',
    content: { text: 'Đơn hàng đã được xác nhận' },
    idempotencyKey: 'msg_confirm_order_123',
  })
  assert.strictEqual(outboxRes2.success, true)
  assert.strictEqual(outboxRes2.isDuplicate, true)

  // Fetch pending messages
  const pending = outbox.fetchPendingMessages(10)
  assert.strictEqual(pending.length, 1)

  // Mark sent
  outbox.markSent(pending[0].id, 'prov_msg_web_888')
  const pendingAfter = outbox.fetchPendingMessages(10)
  assert.strictEqual(pendingAfter.length, 0)

  // 3. Test Scheduler Promises Overdue Detection
  db.prepare(`
    INSERT INTO promises (
      id, tenant_id, shop_id, promise_text, due_at, status, created_at, updated_at
    ) VALUES (
      'prom_overdue_1', 'quannguyens_corp', 'quannguyens_pijama',
      'Cập nhật hành trình bưu tá cho khách',
      datetime('now', '-10 minutes'), 'PENDING',
      datetime('now'), datetime('now')
    )
  `).run()

  const overdue = scheduler.checkOverduePromises()
  assert.strictEqual(overdue.length, 1)
  assert.strictEqual(overdue[0].id, 'prom_overdue_1')

  db.close()
  try {
    fs.unlinkSync(testDbPath)
    if (fs.existsSync(`${testDbPath}-wal`)) fs.unlinkSync(`${testDbPath}-wal`)
    if (fs.existsSync(`${testDbPath}-shm`)) fs.unlinkSync(`${testDbPath}-shm`)
  } catch {}
})
