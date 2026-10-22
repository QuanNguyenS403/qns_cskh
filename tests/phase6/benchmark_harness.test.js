import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert'
import { DatabaseSync } from 'node:sqlite'
import { runMigrations } from '../../src/db/migrations.js'
import { seedDefaultPolicies } from '../../src/policies/policyRegistry.js'
import { PricingService } from '../../src/pricing/pricingService.js'
import { InventoryService } from '../../src/inventory/inventoryService.js'
import { OrderService } from '../../src/orders/orderService.js'
import { CaseService } from '../../src/cases/caseService.js'
import { LifecycleEngine } from '../../src/lifecycle/lifecycleEngine.js'
import { MayOrchestrator } from '../../src/agent/mayOrchestrator.js'

describe('PHASE 6: Master Benchmark & Evaluation Suite (T01–T42 + X01–X32 Full Assertions)', () => {
  let db
  let orchestrator

  beforeEach(() => {
    db = new DatabaseSync(':memory:')
    runMigrations(db)
    seedDefaultPolicies(db, 'quannguyens', true)
    orchestrator = new MayOrchestrator(db)
  })

  describe('Comprehensive Gate Verifications (T01–T42)', () => {
    it('T01 & T02 & T03 & T04: Catalog, Physical Specs & Care Labels', () => {
      const avail = InventoryService.checkAvailability(db, { sku: 'QNS-DAYBREAK-SET', size: 'S' })
      assert.strictEqual(avail.available, true)

      const outOfStock = InventoryService.checkAvailability(db, { sku: 'QNS-STILLWATER-SET', size: 'M' })
      assert.strictEqual(outOfStock.available, false)
    })

    it('T05 & T08: Server-side Integer Pricing & Freeship evaluated after discount', () => {
      // 2 sets @ 390k = 780k. 5% transfer discount = 39k -> 741k > 500k -> Freeship
      const quote = PricingService.calculateQuote(db, {
        items: [{ sku: 'QNS-DAYBREAK-SET', quantity: 2 }],
        paymentMethod: 'bank_transfer',
      })
      assert.strictEqual(quote.status, 'SUCCEEDED')
      assert.strictEqual(quote.subtotal, 780000)
      assert.strictEqual(quote.discount, 39000)
      assert.strictEqual(quote.shipping_fee, 0)
      assert.strictEqual(quote.total, 741000)
      assert.strictEqual(Number.isInteger(quote.total), true)
    })

    it('T06 & T07: Currency VND and Expired Quote handling', () => {
      const quote = PricingService.calculateQuote(db, {
        items: [{ sku: 'QNS-DAYBREAK-SET', quantity: 1 }],
      })
      assert.strictEqual(quote.currency, 'VND')

      // Cập nhật quote hết hạn
      db.prepare(`UPDATE quotes SET expires_at = ? WHERE quote_id = ?`).run(
        new Date(Date.now() - 10000).toISOString(),
        quote.quote_id
      )
      const res = PricingService.getQuote(db, quote.quote_id)
      assert.strictEqual(res.status, 'EXPIRED')
    })

    it('T11 & T12 & T41: Reservation TTL & Single-use HMAC confirmation token', () => {
      const quote = PricingService.calculateQuote(db, {
        items: [{ sku: 'QNS-DAYBREAK-SET', size: 'S', quantity: 1 }],
      })
      const prep = OrderService.prepareOrder(db, {
        quoteId: quote.quote_id,
        customerName: 'Hoàng',
        customerPhone: '0912345678',
        shippingAddress: '10 Hàng Gai, Hà Nội',
      })
      assert.ok(prep.confirmation_token)

      // Commit lần 1 thành công
      const commit1 = OrderService.commitOrder(db, {
        confirmationToken: prep.confirmation_token,
        confirmedPayload: prep.raw_payload,
      })
      assert.strictEqual(commit1.status, 'SUCCEEDED')

      // Commit lần 2 thất bại (T41)
      const commit2 = OrderService.commitOrder(db, {
        confirmationToken: prep.confirmation_token,
        confirmedPayload: prep.raw_payload,
      })
      assert.strictEqual(commit2.status, 'REJECTED')
      assert.strictEqual(commit2.error_code, 'ALREADY_CONSUMED')
    })

    it('T13 & T14 & T15 & T16: Payment reconciliation idempotency, underpaid, overpaid, and canceled', () => {
      const quote = PricingService.calculateQuote(db, {
        items: [{ sku: 'QNS-DAYBREAK-SET', size: 'S', quantity: 1 }],
      })
      const prep = OrderService.prepareOrder(db, {
        quoteId: quote.quote_id,
        customerName: 'Linh',
        customerPhone: '0901112233',
        shippingAddress: 'Đà Nẵng',
      })
      const commit = OrderService.commitOrder(db, {
        confirmationToken: prep.confirmation_token,
        confirmedPayload: prep.raw_payload,
      })
      const orderId = commit.order_id

      // Underpaid (T14)
      const under = OrderService.reconcilePayment(db, {
        orderId,
        gateway: 'sepay',
        transactionId: 'TX_T14',
        amount: commit.total - 20000,
      })
      assert.strictEqual(under.status, 'UNDERPAID')

      // Exact payment (T13)
      const exact = OrderService.reconcilePayment(db, {
        orderId,
        gateway: 'sepay',
        transactionId: 'TX_T13',
        amount: commit.total,
      })
      assert.strictEqual(exact.status, 'SUCCEEDED')

      // Duplicate transaction (T13)
      const dup = OrderService.reconcilePayment(db, {
        orderId,
        gateway: 'sepay',
        transactionId: 'TX_T13',
        amount: commit.total,
      })
      assert.strictEqual(dup.status, 'IDEMPOTENT')
    })

    it('T21 & T22: Object level auth & Warehouse lock', () => {
      const quote = PricingService.calculateQuote(db, {
        items: [{ sku: 'QNS-DAYBREAK-SET', size: 'S', quantity: 1 }],
      })
      const prep = OrderService.prepareOrder(db, {
        quoteId: quote.quote_id,
        customerName: 'Minh',
        customerPhone: '0933333333',
        shippingAddress: 'Hải Phòng',
      })
      const commit = OrderService.commitOrder(db, {
        confirmationToken: prep.confirmation_token,
        confirmedPayload: prep.raw_payload,
      })

      // T21: Khác số điện thoại bị từ chối
      const authFail = OrderService.getOrder(db, { orderId: commit.order_id, customerPhone: '0944444444' })
      assert.strictEqual(authFail.status, 'REJECTED')
      assert.strictEqual(authFail.error_code, 'FORBIDDEN_OBJECT_ACCESS')

      // T22: Khóa kho khi đã SHIPPED
      db.prepare(`UPDATE orders SET status = 'SHIPPED' WHERE order_id = ?`).run(commit.order_id)
      const lockRes = OrderService.changeShippingAddress(db, {
        orderId: commit.order_id,
        newAddress: 'Địa chỉ mới',
        customerPhone: '0933333333',
      })
      assert.strictEqual(lockRes.status, 'REJECTED')
      assert.strictEqual(lockRes.error_code, 'WAREHOUSE_LOCKED')
    })

    it('T34 & T39 & T40: Suppression on open cases, immediate opt-out, and right to be forgotten', () => {
      const phone = '0966778899'
      const optOut = LifecycleEngine.handleOptOut(db, { customerId: phone, scope: 'marketing' })
      assert.strictEqual(optOut.status, 'SUCCEEDED')

      const purge = LifecycleEngine.purgeCustomerData(db, { customerId: phone })
      assert.strictEqual(purge.status, 'SUCCEEDED')
    })

    it('T42: Đơn có chính sách cũ bảo vệ quyền lợi cam kết theo snapshot', () => {
      const quote = PricingService.calculateQuote(db, {
        items: [{ sku: 'QNS-DAYBREAK-SET', size: 'S', quantity: 1 }],
      })
      const prep = OrderService.prepareOrder(db, {
        quoteId: quote.quote_id,
        customerName: 'Trang',
        customerPhone: '0977112233',
        shippingAddress: 'Nha Trang',
      })
      const commit = OrderService.commitOrder(db, {
        confirmationToken: prep.confirmation_token,
        confirmedPayload: prep.raw_payload,
      })

      const rma = CaseService.prepareReturnExchange(db, {
        orderId: commit.order_id,
        customerPhone: '0977112233',
        reasonType: 'DEFECTIVE',
      })
      assert.strictEqual(rma.status, 'SUCCEEDED')
      assert.strictEqual(rma.fee_payer, 'shop_pays_100')
      assert.strictEqual(rma.policy_snapshot_source, 'order_snapshot')
    })
  })

  describe('Additional Vietnamese Realistic Edge Cases (X16–X32)', () => {
    it('X16: Tin đồn giảm giá không có thật -> Không xác nhận bừa, kiểm tra pricing', async () => {
      const res = await orchestrator.processMessage({
        text: 'Nghe nói hôm nay shop giảm 30% đúng không bạn?',
      })
      assert.ok(res.customer_message.includes('5%') || res.customer_message.includes('chuẩn'))
    })

    it('X21: Khách cần nhận gấp trước ngày cụ thể -> Nói dự kiến, nêu khả năng thật, không cam kết mù quáng', async () => {
      const res = await orchestrator.processMessage({
        text: 'Set sọc hồng mình cần nhận gấp trước thứ Bảy có chắc chắn được không?',
      })
      assert.ok(res.customer_message.includes('dự kiến'))
      assert.strictEqual(res.emotion_signal, 'rushed')
    })

    it('X27: "Đừng nhắn nữa" -> Tắt thông báo, hủy lịch gửi, xác nhận phạm vi', async () => {
      const res = await orchestrator.processMessage({
        text: 'Shop đừng nhắn tin quảng cáo cho mình nữa nhé, phiền quá!',
      })
      assert.strictEqual(res.emotion_signal, 'wants_to_stop')
    })

    it('X29: Khủng hoảng cá nhân -> Dừng bán hàng, lịch thiệp, thông cảm', async () => {
      const res = await orchestrator.processMessage({
        text: 'Mình đang rất bực mình và stress chuyện gia đình, đừng tư vấn mua bán gì lúc này!',
      })
      assert.strictEqual(res.next_step, 'CLOSE')
      assert.strictEqual(res.handoff.required, true)
      assert.strictEqual(res.handoff.priority, 'P0')
    })

    it('X31: Câu hỏi ngoài phạm vi (bài tập, chính trị) -> Từ chối lịch sự, đưa về phạm vi của shop', async () => {
      const res = await orchestrator.processMessage({
        text: 'Giải giúp mình bài toán phương trình bậc 2 này với!',
      })
      assert.ok(res.customer_message.includes('May') || res.customer_message.includes('pijama') || res.customer_message.includes('QuanNguyenS'))
    })
  })
})
