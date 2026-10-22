import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert'
import { DatabaseSync } from 'node:sqlite'
import { runMigrations } from '../../src/db/migrations.js'
import { seedDefaultPolicies } from '../../src/policies/policyRegistry.js'
import { PricingService } from '../../src/pricing/pricingService.js'
import { OrderService } from '../../src/orders/orderService.js'
import { CaseService } from '../../src/cases/caseService.js'

describe('PHASE 4: Post-Purchase, Cases, RMA, Tracking & Promises (Gates T23–T30, X23–X26)', () => {
  let db
  let testOrderId
  const testPhone = '0912345678'

  beforeEach(() => {
    db = new DatabaseSync(':memory:')
    runMigrations(db)
    seedDefaultPolicies(db, 'quannguyens', true)

    // Tạo sẵn 1 đơn hàng kiểm thử
    const quote = PricingService.calculateQuote(db, {
      items: [{ sku: 'QNS-DAYBREAK-SET', size: 'S', quantity: 1 }],
    })
    const prep = OrderService.prepareOrder(db, {
      quoteId: quote.quote_id,
      customerName: 'Khách Hàng A',
      customerPhone: testPhone,
      shippingAddress: 'Số 10 Tràng Tiền, Hoàn Kiếm, Hà Nội',
    })
    const commit = OrderService.commitOrder(db, {
      confirmationToken: prep.confirmation_token,
      confirmedPayload: prep.raw_payload,
    })
    testOrderId = commit.order_id
  })

  describe('1. Service Cases & Prioritization (Blueprint §12)', () => {
    it('Tạo Case hỗ trợ với định danh và phân loại ưu tiên P1/P2', () => {
      const res = CaseService.createCase(db, {
        orderId: testOrderId,
        customerId: testPhone,
        issueType: 'DEFECTIVE_PRODUCT',
        summary: 'Khách phản ánh sản phẩm bung chỉ mép cổ áo',
        priority: 'P1',
        ownerRole: 'cs_agent',
      })

      assert.strictEqual(res.status, 'SUCCEEDED')
      assert.ok(res.case_id.startsWith('CASE-'))
      assert.strictEqual(res.priority, 'P1')
      assert.strictEqual(res.case_status, 'OPEN')
      assert.strictEqual(res.evidence_ref, `case:${res.case_id}`)
    })
  })

  describe('2. RMA & Return/Exchange (Gates T42, X23, X24, X25)', () => {
    it('X23: Hàng lỗi do nhà sản xuất -> Shop chịu 100% phí ship 2 chiều', () => {
      const rma = CaseService.prepareReturnExchange(db, {
        orderId: testOrderId,
        customerPhone: testPhone,
        reasonType: 'DEFECTIVE',
      })

      assert.strictEqual(rma.status, 'SUCCEEDED')
      assert.strictEqual(rma.fee_payer, 'shop_pays_100')
      assert.strictEqual(rma.policy_snapshot_source, 'order_snapshot')
    })

    it('X24: Đổi size nhưng size thay thế hết hàng -> Không tự tiện đổi mẫu, đưa lựa chọn thực tế', () => {
      // Yêu cầu đổi sang Stillwater size M (size M của Stillwater trong catalog là hết hàng)
      const rma = CaseService.prepareReturnExchange(db, {
        orderId: testOrderId,
        customerPhone: testPhone,
        reasonType: 'SIZE_EXCHANGE',
        replacementSku: 'QNS-STILLWATER-SET',
        requestedSize: 'M',
      })

      assert.strictEqual(rma.status, 'SIZE_OUT_OF_STOCK')
      assert.strictEqual(rma.requested_size, 'M')
      assert.ok(rma.message.includes('tạm hết hàng'))
      assert.ok(rma.message.includes('(1) Chờ đợt hàng mới, (2) Đổi sang mẫu khác bằng giá, hoặc (3) Trả hàng hoàn tiền'))
    })

    it('X25: Đổi ý trả hàng khi đã quá hạn theo Snapshot -> Từ chối theo quy định cam kết', () => {
      // Cập nhật ngày tạo đơn lùi về 30 ngày trước để quá hạn 7 ngày
      const pastDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      db.prepare(`UPDATE orders SET created_at = ? WHERE order_id = ?`).run(pastDate, testOrderId)

      const rma = CaseService.prepareReturnExchange(db, {
        orderId: testOrderId,
        customerPhone: testPhone,
        reasonType: 'CHANGE_MIND',
      })

      assert.strictEqual(rma.status, 'REJECTED')
      assert.strictEqual(rma.error_code, 'RETURN_WINDOW_EXPIRED')
      assert.ok(rma.message.includes('quá hạn'))
    })
  })

  describe('3. Refund Controls & Anti-Fraud (Gate B08, X26)', () => {
    it('X26: Yêu cầu hoàn tiền sang tài khoản khác nguồn -> Chặn tự động, yêu cầu xác minh và mở case', () => {
      const refundRes = CaseService.prepareRefund(db, {
        orderId: testOrderId,
        customerPhone: testPhone,
        refundAmount: 390000,
        destinationAccount: {
          accountNo: '9999888877',
          bankId: 'VCB',
          isOriginalSource: false, // Tài khoản khác với nguồn đã thanh toán
        },
        reason: 'Khách muốn nhận tiền vào tài khoản bạn của khách',
      })

      assert.strictEqual(refundRes.status, 'REQUIRES_ENHANCED_VERIFICATION')
      assert.ok(refundRes.case_id)
      assert.ok(refundRes.message.includes('xác minh chính chủ'))
    })

    it('Hoàn tiền về tài khoản nguồn gốc trong hạn mức -> Thành công', () => {
      const refundRes = CaseService.prepareRefund(db, {
        orderId: testOrderId,
        customerPhone: testPhone,
        refundAmount: 390000,
        destinationAccount: {
          accountNo: '0988888888',
          bankId: 'MBBank',
          isOriginalSource: true,
        },
        reason: 'Sản phẩm lỗi đổi trả',
      })

      assert.strictEqual(refundRes.status, 'SUCCEEDED')
      assert.ok(refundRes.refund_id.startsWith('REF-'))
      assert.strictEqual(refundRes.amount, 390000)
    })
  })

  describe('4. Tracking & Delivery Disputes (Blueprint §8.8, V6, X21)', () => {
    it('Đơn hàng mới tạo tại kho hiển thị trạng thái PROCESSING_AT_WAREHOUSE', () => {
      const tracking = CaseService.getTracking(db, { orderId: testOrderId })
      assert.strictEqual(tracking.status, 'SUCCEEDED')
      assert.strictEqual(tracking.tracking_status, 'PROCESSING_AT_WAREHOUSE')
    })

    it('V6: Scan "DELIVERED" nhưng khách khiếu nại chưa nhận -> Mở Case P1 kiểm tra hãng, không đổ lỗi', () => {
      // Giả lập kiện hàng đã scan DELIVERED
      db.prepare(`
        INSERT INTO shipments (
          id, tenant_id, shop_id, order_id, carrier, tracking_code, status, delivered_at, created_at, updated_at
        ) VALUES ('SHP-001', 'default', 'quannguyens', ?, 'Viettel Post', 'VTP998877', 'DELIVERED', ?, ?, ?)
      `).run(testOrderId, new Date().toISOString(), new Date().toISOString(), new Date().toISOString())

      const disputeRes = CaseService.getTracking(db, {
        orderId: testOrderId,
        customerReportNotReceived: true,
      })

      assert.strictEqual(disputeRes.status, 'DISPUTE_OPENED')
      assert.ok(disputeRes.case_id)
      assert.ok(disputeRes.message.includes('chưa nhận được kiện hàng dù hệ thống có scan đã giao'))
      assert.ok(disputeRes.message.includes('đối soát với Viettel Post'))
    })
  })

  describe('5. Commitments & Promises Engine (Gate B13)', () => {
    it('B13: Mọi lời hẹn đều có bản ghi cam kết, hạn chót ISO và người phụ trách', () => {
      const dueAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
      const promise = CaseService.createPromise(db, {
        orderId: testOrderId,
        customerId: testPhone,
        promiseText: 'Cập nhật kết quả kiểm tra với bưu cục Viettel Post',
        dueAt,
        ownerRole: 'carrier_liaison',
      })

      assert.strictEqual(promise.status, 'SUCCEEDED')
      assert.ok(promise.promise_id.startsWith('PRM-'))
      assert.strictEqual(promise.due_at, dueAt)
      assert.strictEqual(promise.owner_role, 'carrier_liaison')

      // Kiểm tra lưu bền vững trong CSDL
      const row = db.prepare(`SELECT * FROM promises WHERE id = ?`).get(promise.promise_id)
      assert.strictEqual(row.status, 'PENDING')
      assert.strictEqual(row.promise_text, 'Cập nhật kết quả kiểm tra với bưu cục Viettel Post')
    })
  })
})
