import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert'
import { DatabaseSync } from 'node:sqlite'
import { runMigrations } from '../../src/db/migrations.js'
import { seedDefaultPolicies } from '../../src/policies/policyRegistry.js'
import { PricingService } from '../../src/pricing/pricingService.js'
import { InventoryService } from '../../src/inventory/inventoryService.js'
import { OrderService } from '../../src/orders/orderService.js'

describe('PHASE 3: Transactional Tools, Orders & Payments (Gates B05–B10, T11–T22, X16–X22)', () => {
  let db

  beforeEach(() => {
    db = new DatabaseSync(':memory:')
    runMigrations(db)
    seedDefaultPolicies(db, 'quannguyens', true)
  })

  describe('1. Inventory Availability & Stock Reservations (Gates T02, T11)', () => {
    it('Kiểm tra tồn kho chính xác và phân biệt biến thể có sẵn vs hết hàng', () => {
      // Daybreak S có sẵn 10 cái
      const daybreakAvail = InventoryService.checkAvailability(db, {
        sku: 'QNS-DAYBREAK-SET',
        size: 'S',
      })
      assert.strictEqual(daybreakAvail.available, true)
      assert.strictEqual(daybreakAvail.availableStock, 10)

      // Stillwater M không có sẵn (hết hàng)
      const stillwaterAvail = InventoryService.checkAvailability(db, {
        sku: 'QNS-STILLWATER-SET',
        size: 'M',
      })
      assert.strictEqual(stillwaterAvail.available, false)
      assert.strictEqual(stillwaterAvail.availableStock, 0)
    })

    it('T11: Giữ tồn kho nguyên tử (Reservation) có TTL làm giảm tồn kho khả dụng', () => {
      // Giữ 3 bộ Daybreak S
      const res = InventoryService.reserveStock(db, {
        sku: 'QNS-DAYBREAK-SET',
        size: 'S',
        quantity: 3,
        ttlMinutes: 15,
      })

      assert.strictEqual(res.status, 'SUCCEEDED')
      assert.ok(res.reservation_id.startsWith('RES-'))

      // Kiểm tra lại tồn kho: ban đầu 10 - giữ 3 = còn 7
      const checkAfter = InventoryService.checkAvailability(db, {
        sku: 'QNS-DAYBREAK-SET',
        size: 'S',
      })
      assert.strictEqual(checkAfter.availableStock, 7)
      assert.strictEqual(checkAfter.reservedStock, 3)

      // Khi giải phóng reservation -> tồn kho phục hồi về 10
      InventoryService.releaseReservation(db, res.reservation_id)
      const checkReleased = InventoryService.checkAvailability(db, {
        sku: 'QNS-DAYBREAK-SET',
        size: 'S',
      })
      assert.strictEqual(checkReleased.availableStock, 10)
    })
  })

  describe('2. Order Lifecycle: prepare_order -> commit_order (Gates B06, T07, T42)', () => {
    it('prepare_order cấp Token xác nhận và commit_order chốt đơn thành công', () => {
      // 1. Tạo Quote
      const quote = PricingService.calculateQuote(db, {
        items: [{ sku: 'QNS-DAYBREAK-SET', size: 'S', quantity: 1 }],
      })

      // 2. Prepare Order
      const prepareRes = OrderService.prepareOrder(db, {
        quoteId: quote.quote_id,
        customerName: 'Nguyễn Văn A',
        customerPhone: '0912345678',
        shippingAddress: '123 Phố Huế, Hai Bà Trưng, Hà Nội',
        paymentMethod: 'cod',
      })

      assert.strictEqual(prepareRes.status, 'SUCCEEDED')
      assert.ok(prepareRes.confirmation_token)
      assert.ok(prepareRes.order_draft.recipient.includes('091****678'))

      // 3. Commit Order với payload đã xác nhận
      const commitRes = OrderService.commitOrder(db, {
        confirmationToken: prepareRes.confirmation_token,
        confirmedPayload: prepareRes.raw_payload,
      })

      assert.strictEqual(commitRes.status, 'SUCCEEDED')
      assert.ok(commitRes.order_id.startsWith('QNS-'))
      assert.strictEqual(commitRes.order_status, 'CONFIRMED')
      assert.strictEqual(commitRes.payment_status, 'UNPAID')

      // Kiểm tra Quote đã bị tiêu thụ
      const quoteConsumed = PricingService.getQuote(db, quote.quote_id)
      assert.strictEqual(quoteConsumed.quote.is_consumed, true)
    })

    it('B06: Token xác nhận bị từ chối nếu payload bị sửa đổi trái phép', () => {
      const quote = PricingService.calculateQuote(db, {
        items: [{ sku: 'QNS-DAYBREAK-SET', size: 'S', quantity: 1 }],
      })

      const prepareRes = OrderService.prepareOrder(db, {
        quoteId: quote.quote_id,
        customerName: 'Nguyễn Văn A',
        customerPhone: '0912345678',
        shippingAddress: '123 Phố Huế, Hà Nội',
      })

      // Giả mạo payload: Tự ý giảm tổng tiền từ 420.000đ xuống 100.000đ
      const tamperedPayload = { ...prepareRes.raw_payload, total: 100000 }

      const commitRes = OrderService.commitOrder(db, {
        confirmationToken: prepareRes.confirmation_token,
        confirmedPayload: tamperedPayload,
      })

      assert.strictEqual(commitRes.status, 'REJECTED')
      assert.strictEqual(commitRes.error_code, 'PAYLOAD_MUTATED')
    })

    it('B06: Token xác nhận là Single-Use, không thể commit 2 lần', () => {
      const quote = PricingService.calculateQuote(db, {
        items: [{ sku: 'QNS-DAYBREAK-SET', size: 'S', quantity: 1 }],
      })

      const prepareRes = OrderService.prepareOrder(db, {
        quoteId: quote.quote_id,
        customerName: 'Nguyễn Văn B',
        customerPhone: '0988776655',
        shippingAddress: '456 Lê Lợi, TP.HCM',
      })

      // Lần 1: Thành công
      const commit1 = OrderService.commitOrder(db, {
        confirmationToken: prepareRes.confirmation_token,
        confirmedPayload: prepareRes.raw_payload,
      })
      assert.strictEqual(commit1.status, 'SUCCEEDED')

      // Lần 2 với cùng token: Bị từ chối
      const commit2 = OrderService.commitOrder(db, {
        confirmationToken: prepareRes.confirmation_token,
        confirmedPayload: prepareRes.raw_payload,
      })
      assert.strictEqual(commit2.status, 'REJECTED')
      assert.strictEqual(commit2.error_code, 'ALREADY_CONSUMED')
    })
  })

  describe('3. Object-level Authorization on get_order (Gates B10, X12)', () => {
    let testOrderId

    beforeEach(() => {
      const quote = PricingService.calculateQuote(db, {
        items: [{ sku: 'QNS-DAYBREAK-SET', size: 'S', quantity: 1 }],
      })
      const prepareRes = OrderService.prepareOrder(db, {
        quoteId: quote.quote_id,
        customerName: 'Trần Thị C',
        customerPhone: '0901234567',
        shippingAddress: '789 Trần Hưng Đạo, Đà Nẵng',
      })
      const commitRes = OrderService.commitOrder(db, {
        confirmationToken: prepareRes.confirmation_token,
        confirmedPayload: prepareRes.raw_payload,
      })
      testOrderId = commitRes.order_id
    })

    it('X12: Đúng mã đơn nhưng SĐT không khớp -> Bị từ chối, không lộ dữ liệu đơn', () => {
      const result = OrderService.getOrder(db, {
        orderId: testOrderId,
        customerPhone: '0999999999', // Sai số điện thoại
      })

      assert.strictEqual(result.status, 'REJECTED')
      assert.strictEqual(result.error_code, 'FORBIDDEN_OBJECT_ACCESS')
      assert.strictEqual(result.order, undefined)
    })

    it('Đúng mã đơn và đúng SĐT -> Trả về thông tin đơn an toàn đã che bớt PII', () => {
      const result = OrderService.getOrder(db, {
        orderId: testOrderId,
        customerPhone: '0901234567',
      })

      assert.strictEqual(result.status, 'SUCCEEDED')
      assert.strictEqual(result.order.order_id, testOrderId)
      assert.ok(result.order.customer_phone.includes('090****567'))
    })
  })

  describe('4. Payment Request & VietQR (Gates B09, B19)', () => {
    it('Tạo yêu cầu thanh toán VietQR với tài khoản do máy chủ quản lý', () => {
      const quote = PricingService.calculateQuote(db, {
        items: [{ sku: 'QNS-DAYBREAK-SET', size: 'S', quantity: 1 }],
      })
      const prepareRes = OrderService.prepareOrder(db, {
        quoteId: quote.quote_id,
        customerName: 'Lê Văn D',
        customerPhone: '0933445566',
        shippingAddress: '10 Hai Bà Trưng, Hà Nội',
        paymentMethod: 'bank_transfer',
      })
      const commitRes = OrderService.commitOrder(db, {
        confirmationToken: prepareRes.confirmation_token,
        confirmedPayload: prepareRes.raw_payload,
      })

      const payReq = OrderService.createPaymentRequest(db, { orderId: commitRes.order_id })
      assert.strictEqual(payReq.status, 'SUCCEEDED')
      assert.strictEqual(payReq.amount, commitRes.total)
      assert.ok(payReq.qr_url.startsWith('https://img.vietqr.io/image/'))
      assert.ok(payReq.transfer_content.includes('QNS'))
    })
  })

  describe('5. Payment Reconciliation & Branches (Gates B08, T13, X17, X18)', () => {
    let orderId
    let expectedTotal

    beforeEach(() => {
      const quote = PricingService.calculateQuote(db, {
        items: [{ sku: 'QNS-DAYBREAK-SET', size: 'S', quantity: 1 }],
      })
      const prepareRes = OrderService.prepareOrder(db, {
        quoteId: quote.quote_id,
        customerName: 'Hoàng Văn E',
        customerPhone: '0911223344',
        shippingAddress: '15 Lý Tự Trọng, Cần Thơ',
      })
      const commitRes = OrderService.commitOrder(db, {
        confirmationToken: prepareRes.confirmation_token,
        confirmedPayload: prepareRes.raw_payload,
      })
      orderId = commitRes.order_id
      expectedTotal = commitRes.total // 420.000đ
    })

    it('T13: Giao dịch ngân hàng trùng lặp là Idempotent', () => {
      const txId = 'TX_TEST_RECONCILE_001'
      const first = OrderService.reconcilePayment(db, {
        orderId,
        gateway: 'sepay',
        transactionId: txId,
        amount: expectedTotal,
      })
      assert.strictEqual(first.status, 'SUCCEEDED')
      assert.strictEqual(first.reconciliation_status, 'PAID')

      // Lần 2 với cùng transactionId
      const second = OrderService.reconcilePayment(db, {
        orderId,
        gateway: 'sepay',
        transactionId: txId,
        amount: expectedTotal,
      })
      assert.strictEqual(second.status, 'IDEMPOTENT')
      assert.strictEqual(second.isDuplicate, true)
    })

    it('X17: Chuyển thiếu tiền -> KHÔNG ghi nhận PAID, thông báo thiếu', () => {
      const txId = 'TX_UNDERPAID_002'
      const partialAmount = expectedTotal - 50000 // Thiếu 50.000đ

      const result = OrderService.reconcilePayment(db, {
        orderId,
        gateway: 'sepay',
        transactionId: txId,
        amount: partialAmount,
      })

      assert.strictEqual(result.status, 'UNDERPAID')
      assert.strictEqual(result.shortage, 50000)

      // Kiểm tra trạng thái đơn: Vẫn là UNPAID
      const checkOrder = db.prepare(`SELECT payment_status FROM orders WHERE order_id = ?`).get(orderId)
      assert.strictEqual(checkOrder.payment_status, 'UNPAID')
    })

    it('X17: Chuyển thừa tiền -> Ghi nhận PAID kèm cờ OVERPAID', () => {
      const txId = 'TX_OVERPAID_003'
      const excessAmount = expectedTotal + 20000 // Thừa 20.000đ

      const result = OrderService.reconcilePayment(db, {
        orderId,
        gateway: 'sepay',
        transactionId: txId,
        amount: excessAmount,
      })

      assert.strictEqual(result.status, 'OVERPAID')
      assert.strictEqual(result.overage, 20000)

      // Kiểm tra trạng thái đơn: Đã chuyển sang PAID
      const checkOrder = db.prepare(`SELECT payment_status FROM orders WHERE order_id = ?`).get(orderId)
      assert.strictEqual(checkOrder.payment_status, 'PAID')
    })

    it('X18: Chuyển khoản vào đơn đã bị hủy -> Gắn cờ FLAGGED_CANCELLED_ORDER', () => {
      // Hủy đơn hàng trước
      db.prepare(`UPDATE orders SET status = 'CANCELLED' WHERE order_id = ?`).run(orderId)

      const result = OrderService.reconcilePayment(db, {
        orderId,
        gateway: 'sepay',
        transactionId: 'TX_CANCELLED_004',
        amount: expectedTotal,
      })

      assert.strictEqual(result.status, 'FLAGGED_CANCELLED_ORDER')
    })
  })

  describe('6. Order Modifications & Warehouse Lock (Blueprint §11.4, X22)', () => {
    let orderId

    beforeEach(() => {
      const quote = PricingService.calculateQuote(db, {
        items: [{ sku: 'QNS-DAYBREAK-SET', size: 'S', quantity: 1 }],
      })
      const prepareRes = OrderService.prepareOrder(db, {
        quoteId: quote.quote_id,
        customerName: 'Phạm Thị F',
        customerPhone: '0977889900',
        shippingAddress: 'Địa chỉ cũ',
      })
      const commitRes = OrderService.commitOrder(db, {
        confirmationToken: prepareRes.confirmation_token,
        confirmedPayload: prepareRes.raw_payload,
      })
      orderId = commitRes.order_id
    })

    it('Đổi địa chỉ thành công khi kho chưa giao hàng', () => {
      const res = OrderService.changeShippingAddress(db, {
        orderId,
        newAddress: 'Số 99 Nguyễn Du, Hà Nội',
        customerPhone: '0977889900',
      })

      assert.strictEqual(res.status, 'SUCCEEDED')
      assert.strictEqual(res.new_shipping_address, 'Số 99 Nguyễn Du, Hà Nội')
    })

    it('X22: Từ chối đổi trực tiếp khi đơn đã bàn giao đối tác (WAREHOUSE_LOCKED)', () => {
      // Cập nhật đơn sang trạng thái SHIPPED
      db.prepare(`UPDATE orders SET status = 'SHIPPED' WHERE order_id = ?`).run(orderId)

      const res = OrderService.changeShippingAddress(db, {
        orderId,
        newAddress: 'Số 99 Nguyễn Du, Hà Nội',
        customerPhone: '0977889900',
      })

      assert.strictEqual(res.status, 'REJECTED')
      assert.strictEqual(res.error_code, 'WAREHOUSE_LOCKED')
    })
  })
})
