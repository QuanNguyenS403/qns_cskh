import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert'
import { DatabaseSync } from 'node:sqlite'
import { runMigrations } from '../../src/db/migrations.js'
import { seedDefaultPolicies } from '../../src/policies/policyRegistry.js'
import { LifecycleEngine } from '../../src/lifecycle/lifecycleEngine.js'
import { CaseService } from '../../src/cases/caseService.js'

describe('PHASE 5: Outbound Lifecycle Automation & Consent Engine (Gates B11, B12, T34–T41, X27–X32)', () => {
  let db
  const testPhone = '0988112233'
  const testOrderId = 'QNS-ORDER-TEST-001'

  beforeEach(() => {
    db = new DatabaseSync(':memory:')
    runMigrations(db)
    seedDefaultPolicies(db, 'quannguyens', true)

    // Tạo đơn hàng giả lập
    db.prepare(`
      INSERT INTO orders (
        order_id, tenant_id, shop_id, customer_name, customer_phone, shipping_address,
        items_json, subtotal, total, status, payment_status, created_at, updated_at
      ) VALUES (?, 'default', 'quannguyens', 'Nguyễn Thị D', ?, 'Phố Cổ, Hà Nội', '[]', 500000, 500000, 'DELIVERED', 'PAID', ?, ?)
    `).run(testOrderId, testPhone, new Date().toISOString(), new Date().toISOString())
  })

  describe('1. Consent Management & Immediate Opt-out (Gates B12, X27)', () => {
    it('B12 & X27: Khi khách yêu cầu "tắt quảng cáo", lập tức hủy mọi Job marketing đang chờ', () => {
      // 1. Tạo 2 Job marketing đang chờ gửi trong bảng jobs
      db.prepare(`
        INSERT INTO jobs (id, business_key, job_type, payload_json, status, eligible_after, created_at, updated_at)
        VALUES ('JOB-MKT-01', 'mkt:01', 'outbound_marketing', ?, 'READY', ?, ?, ?)
      `).run(
        JSON.stringify({ customerId: testPhone, campaign: 'xmas_sale' }),
        new Date().toISOString(),
        new Date().toISOString(),
        new Date().toISOString()
      )

      db.prepare(`
        INSERT INTO jobs (id, business_key, job_type, payload_json, status, eligible_after, created_at, updated_at)
        VALUES ('JOB-MKT-02', 'mkt:02', 'outbound_marketing', ?, 'READY', ?, ?, ?)
      `).run(
        JSON.stringify({ customerId: testPhone, campaign: 'tet_sale' }),
        new Date().toISOString(),
        new Date().toISOString(),
        new Date().toISOString()
      )

      // 2. Khách nhắn yêu cầu opt-out marketing
      const optOutRes = LifecycleEngine.handleOptOut(db, {
        customerId: testPhone,
        scope: 'marketing',
      })

      assert.strictEqual(optOutRes.status, 'SUCCEEDED')
      assert.strictEqual(optOutRes.cancelled_jobs_count, 2, 'Phải hủy đủ 2 job đang chờ của khách')

      // Kiểm tra trạng thái trong bảng jobs
      const jobs = db.prepare(`SELECT status, last_error FROM jobs WHERE id IN ('JOB-MKT-01', 'JOB-MKT-02')`).all()
      for (const j of jobs) {
        assert.strictEqual(j.status, 'CANCELLED')
        assert.ok(j.last_error.includes('Customer opted out'))
      }
    })
  })

  describe('2. Right to be Forgotten & Data Purge (Gate B11)', () => {
    it('B11: Xóa số đo, sở thích cá nhân và ẩn danh đơn hàng nhưng giữ chứng từ kế toán', () => {
      // Tạo preference và memory fact cho khách
      db.prepare(`
        INSERT INTO preferences (id, tenant_id, shop_id, customer_id, key, value_json, source, purpose, recorded_at, updated_at)
        VALUES ('PREF-1', 'default', 'quannguyens', ?, 'fit_preference', '"relaxed"', 'chat', 'styling', ?, ?)
      `).run(testPhone, new Date().toISOString(), new Date().toISOString())

      db.prepare(`
        INSERT INTO memory_facts (id, tenant_id, shop_id, customer_id, attribute, value_json, source_type, purpose, recorded_at)
        VALUES ('MEM-1', 'default', 'quannguyens', ?, 'waist_cm', '68', 'customer', 'size', ?)
      `).run(testPhone, new Date().toISOString())

      // Thực thi xóa dữ liệu cá nhân theo yêu cầu
      const purgeRes = LifecycleEngine.purgeCustomerData(db, { customerId: testPhone })

      assert.strictEqual(purgeRes.status, 'SUCCEEDED')
      assert.strictEqual(purgeRes.preferences_deleted, 1)
      assert.strictEqual(purgeRes.memory_facts_deleted, 1)
      assert.strictEqual(purgeRes.orders_anonymized, 1)

      // Kiểm tra đơn hàng: Thông tin PII bị ẩn danh hóa, nhưng mã đơn và số tiền còn nguyên
      const order = db.prepare(`SELECT customer_name, shipping_address, total FROM orders WHERE order_id = ?`).get(testOrderId)
      assert.strictEqual(order.customer_name, 'KHÁCH HÀNG ĐÃ XÓA DỮ LIỆU')
      assert.strictEqual(order.shipping_address, '[ĐÃ XÓA THEO YÊU CẦU]')
      assert.strictEqual(order.total, 500000, 'Số tiền kế toán phải được lưu giữ')
    })
  })

  describe('3. Post-Purchase Care & Open Case Suppression (Gates B12, T34)', () => {
    it('T34: Chặn gửi tin chăm sóc / bán thêm nếu đơn hàng đang có Case khiếu nại mở', () => {
      // 1. Lên lịch chăm sóc sau mua
      const checkinJob = LifecycleEngine.schedulePostPurchaseCheckin(db, {
        orderId: testOrderId,
        customerId: testPhone,
        channel: 'messenger',
        recipientId: 'fb_user_123',
        deliveredAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), // Đã nhận hơn 24 giờ
      })

      // 2. Khách có khiếu nại đang xử lý (Mở case P1)
      CaseService.createCase(db, {
        orderId: testOrderId,
        customerId: testPhone,
        issueType: 'DEFECTIVE_PRODUCT',
        summary: 'Áo bị rách mép tay',
        priority: 'P1',
      })

      // 3. Worker lấy job ra để xử lý
      const jobRow = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(checkinJob.job_id)
      const dispatchResult = LifecycleEngine.evaluateAndDispatchJob(db, jobRow)

      // Bắt buộc phải bị CHẶN vì đang có case mở (T34)
      assert.strictEqual(dispatchResult.status, 'DENIED')
      assert.strictEqual(dispatchResult.reason, 'SUPPRESSED_OPEN_CASE')

      // Kiểm tra trạng thái job
      const updatedJob = db.prepare(`SELECT status FROM jobs WHERE id = ?`).get(checkinJob.job_id)
      assert.strictEqual(updatedJob.status, 'SUPPRESSED_CASE_OPEN')
    })

    it('Gửi tin chăm sóc thành công khi không có khiếu nại mở và trong khung giờ cho phép', () => {
      const checkinJob = LifecycleEngine.schedulePostPurchaseCheckin(db, {
        orderId: testOrderId,
        customerId: testPhone,
        channel: 'messenger',
        recipientId: 'fb_user_456',
        deliveredAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      })

      const jobRow = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(checkinJob.job_id)
      const dispatchResult = LifecycleEngine.evaluateAndDispatchJob(db, jobRow)

      assert.strictEqual(dispatchResult.status, 'ALLOWED')
      assert.strictEqual(dispatchResult.dispatched, true)
    })
  })
})
