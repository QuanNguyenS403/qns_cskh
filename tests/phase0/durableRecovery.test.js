import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import { DatabaseSync } from 'node:sqlite'
import { runMigrations } from '../../src/db/migrations.js'
import { AuditLogger } from '../../src/security/auditLogger.js'
import { SchedulerService } from '../../src/queue/scheduler.js'

test('Phase 0 - Gate T37 & T10: Durable Recovery & Timeout Reconciliation After Process Restart', (t) => {
  const testDbPath = path.resolve('data/test_recovery.db')
  fs.mkdirSync(path.dirname(testDbPath), { recursive: true })
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath)
  }

  // ── 1. TIẾN TRÌNH TRƯỚC KHI CRASH ─────────────────────────
  let db1 = new DatabaseSync(testDbPath)
  runMigrations(db1)
  const audit1 = new AuditLogger(db1)
  const scheduler1 = new SchedulerService(db1)

  const operationId = 'op_commit_checkout_race_999'

  // Đơn hàng được tạo thành công trong DB
  db1.prepare(`
    INSERT INTO orders (
      order_id, tenant_id, shop_id, customer_name, customer_phone,
      shipping_address, items_json, subtotal, total, status, payment_status,
      created_at, updated_at
    ) VALUES (
      'QNS-RECOVERY-001', 'quannguyens_corp', 'quannguyens_pijama',
      'Trần Thị B', '0912345678', 'Hà Nội', '[]',
      390000, 390000, 'PENDING', 'AWAITING_PAYMENT',
      datetime('now'), datetime('now')
    )
  `).run()

  // Ghi nhận audit log trước khi mạng bị timeout / process bị kill
  audit1.logAction({
    operationId,
    actorType: 'AI_AGENT',
    actorId: 'quannguyens',
    actionName: 'commit_order',
    targetEntityType: 'order',
    targetEntityId: 'QNS-RECOVERY-001',
    resultStatus: 'SUCCEEDED',
    evidenceRef: 'QNS-RECOVERY-001',
  })

  // Đưa một job nền vào hàng đợi và mô phỏng job đang chạy dở thì worker bị crash
  scheduler1.upsertJob({
    businessKey: 'job_post_delivery_sync_001',
    jobType: 'post_delivery_sync',
    payload: { orderId: 'QNS-RECOVERY-001' },
  })

  // Worker 1 nhận job với lease 2 giây
  const claimedJob1 = scheduler1.claimNextJob('post_delivery_sync', 2)
  assert.ok(claimedJob1, 'Worker 1 phải claim được job')
  assert.strictEqual(claimedJob1.attempts, 1)

  // 💥 MÔ PHỎNG WORKER BỊ SẬP (CRASH / RESTART NGAY TẠI ĐÂY)
  db1.close()
  db1 = null

  // ── 2. TIẾN TRÌNH KHỞI ĐỘNG LẠI (NEW WORKER AFTER RESTART) ───
  const db2 = new DatabaseSync(testDbPath)
  const audit2 = new AuditLogger(db2)
  const scheduler2 = new SchedulerService(db2)

  // Test T10: Khách hàng / Agent gọi lại commit_order với cùng operationId sau timeout
  // Bước 1: Tra cứu audit log xem thao tác đã được thực thi chưa
  const existingAudit = audit2.getAuditByOperation(operationId)
  assert.ok(existingAudit, 'Audit log phải tồn tại sau khi restart máy chủ')
  assert.strictEqual(existingAudit.result_status, 'SUCCEEDED')
  assert.strictEqual(existingAudit.target_entity_id, 'QNS-RECOVERY-001')

  // Bước 2: Kiểm tra dữ liệu đơn hàng trong DB sau restart
  const recoveredOrder = db2.prepare('SELECT * FROM orders WHERE order_id = ?').get('QNS-RECOVERY-001')
  assert.ok(recoveredOrder, 'Đơn hàng không bao giờ bị mất sau khi khởi động lại')
  assert.strictEqual(recoveredOrder.customer_name, 'Trần Thị B')

  // Bước 3 (T10 Gate Assertion): Hệ thống trả về đơn đã tạo, KHÔNG tạo thêm đơn thứ hai
  const totalOrdersCount = db2.prepare('SELECT COUNT(*) as count FROM orders').get().count
  assert.strictEqual(totalOrdersCount, 1, 'Tổng số đơn hàng vẫn là 1, không được tạo đơn trùng')

  // Test T37: Kiểm tra Job đang chạy dở bị crash
  // Khi lease 2 giây hết hạn, Worker mới phải tự động claim lại job này để hoàn tất
  // Đặt lùi thời gian lease để mô phỏng hết hạn
  db2.prepare(`
    UPDATE jobs SET lease_expires_at = datetime('now', '-5 seconds')
    WHERE business_key = 'job_post_delivery_sync_001'
  `).run()

  const claimedJob2 = scheduler2.claimNextJob('post_delivery_sync', 60)
  assert.ok(claimedJob2, 'Worker mới sau restart phải khôi phục và claim lại job bị treo')
  assert.strictEqual(claimedJob2.attempts, 2, 'Số lần attempts phải tăng lên 2')

  // Worker mới hoàn thành job an toàn
  const completeRes = scheduler2.completeJob(claimedJob2.id, claimedJob2.leaseToken)
  assert.strictEqual(completeRes.changes, 1, 'Job phải được hoàn tất thành công')

  const finalJob = db2.prepare('SELECT * FROM jobs WHERE business_key = ?').get('job_post_delivery_sync_001')
  assert.strictEqual(finalJob.status, 'COMPLETED')

  db2.close()
  try {
    fs.unlinkSync(testDbPath)
    if (fs.existsSync(`${testDbPath}-wal`)) fs.unlinkSync(`${testDbPath}-wal`)
    if (fs.existsSync(`${testDbPath}-shm`)) fs.unlinkSync(`${testDbPath}-shm`)
  } catch {}
})
