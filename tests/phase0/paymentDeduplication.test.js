import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import { DatabaseSync } from 'node:sqlite'
import { runMigrations } from '../../src/db/migrations.js'
import { EventGateway } from '../../src/events/eventGateway.js'

test('Phase 0 - Gate T13: Payment Webhook Deduplication (Chỉ ghi một lần)', (t) => {
  const testDbPath = path.resolve('data/test_dedup.db')
  fs.mkdirSync(path.dirname(testDbPath), { recursive: true })
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath)
  }

  const db = new DatabaseSync(testDbPath)
  runMigrations(db)

  // Tạo đơn hàng mẫu
  db.prepare(`
    INSERT INTO orders (
      order_id, tenant_id, shop_id, customer_name, customer_phone,
      shipping_address, items_json, subtotal, total, status, payment_status,
      created_at, updated_at
    ) VALUES (
      'QNS-TEST-DEDUP-001', 'quannguyens_corp', 'quannguyens_pijama',
      'Nguyễn Văn A', '0981753082', 'Amber Riverside', '[]',
      550000, 495000, 'CONFIRMED', 'AWAITING_PAYMENT',
      datetime('now'), datetime('now')
    )
  `).run()

  const gateway = new EventGateway(db)

  // 1. Gửi Webhook lần 1
  const payload = {
    id: 'TX_SEPAY_999888',
    amount: 495000,
    content: 'QNS-TEST-DEDUP-001 NGUYEN VAN A',
    gateway: 'Vietcombank',
  }

  const res1 = gateway.ingestEvent({
    eventId: 'TX_SEPAY_999888',
    source: 'sepay',
    eventType: 'payment.received',
    entityType: 'payment',
    entityId: 'TX_SEPAY_999888',
    payload,
    signatureVerified: true,
  })

  assert.strictEqual(res1.isDuplicate, false, 'Lần 1 phải được chấp nhận')
  assert.strictEqual(res1.status, 'ACCEPTED')

  // Ghi nhận thanh toán vào bảng payments
  db.prepare(`
    INSERT INTO payments (
      id, tenant_id, shop_id, order_id, gateway, transaction_id,
      amount, status, paid_at, created_at, updated_at
    ) VALUES (
      'pay_001', 'quannguyens_corp', 'quannguyens_pijama',
      'QNS-TEST-DEDUP-001', 'sepay', 'TX_SEPAY_999888',
      495000, 'PAID', datetime('now'), datetime('now'), datetime('now')
    )
  `).run()

  // 2. Gửi Webhook lần 2 (Cùng eventId + source)
  const res2 = gateway.ingestEvent({
    eventId: 'TX_SEPAY_999888',
    source: 'sepay',
    eventType: 'payment.received',
    entityType: 'payment',
    entityId: 'TX_SEPAY_999888',
    payload,
    signatureVerified: true,
  })

  assert.strictEqual(res2.isDuplicate, true, 'Lần 2 phải nhận diện là duplicate')
  assert.strictEqual(res2.status, 'DUPLICATE_IGNORED')

  // 3. Gửi Webhook lần 3 (Lặp lại lần nữa)
  const res3 = gateway.ingestEvent({
    eventId: 'TX_SEPAY_999888',
    source: 'sepay',
    eventType: 'payment.received',
    entityType: 'payment',
    entityId: 'TX_SEPAY_999888',
    payload,
    signatureVerified: true,
  })

  assert.strictEqual(res3.isDuplicate, true, 'Lần 3 vẫn là duplicate')

  // 4. Kiểm tra trong Database: Chỉ có DUY NHẤT 1 bản ghi payment
  const paymentRecords = db.prepare(`
    SELECT * FROM payments WHERE gateway = 'sepay' AND transaction_id = 'TX_SEPAY_999888'
  `).all()

  assert.strictEqual(paymentRecords.length, 1, 'Chỉ được có đúng 1 bản ghi payment trong database')

  // 5. Thử chèn trực tiếp cùng gateway + transaction_id vào bảng payments: Phải bị chặn bởi UNIQUE constraint
  assert.throws(() => {
    db.prepare(`
      INSERT INTO payments (
        id, tenant_id, shop_id, order_id, gateway, transaction_id,
        amount, status, paid_at, created_at, updated_at
      ) VALUES (
        'pay_002', 'quannguyens_corp', 'quannguyens_pijama',
        'QNS-TEST-DEDUP-001', 'sepay', 'TX_SEPAY_999888',
        495000, 'PAID', datetime('now'), datetime('now'), datetime('now')
      )
    `).run()
  }, /UNIQUE constraint failed/, 'Bảng payments phải chặn trùng gateway + transaction_id ở cấp độ CSDL')

  db.close()
  try {
    fs.unlinkSync(testDbPath)
    if (fs.existsSync(`${testDbPath}-wal`)) fs.unlinkSync(`${testDbPath}-wal`)
    if (fs.existsSync(`${testDbPath}-shm`)) fs.unlinkSync(`${testDbPath}-shm`)
  } catch {}
})
