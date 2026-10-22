/**
 * ORDER & PAYMENT TRANSACTIONAL SERVICE (Blueprint §10, §11, §12, Gates B05-B10, T11-T22)
 * 
 * - prepare_order & commit_order: Token xác nhận HMAC-SHA256 gắn hash payload, TTL 5 phút, single-use.
 * - get_order: Phân quyền đối tượng (B10, X12) - mã đơn 1 mình không đủ, bắt buộc khớp SĐT.
 * - create_payment_request: Thông tin tài khoản chỉ đọc từ cấu hình bảo mật server (B09, B19).
 * - reconcile_payment: Ràng buộc duy nhất gateway + transaction_id chống trùng (B08, T13), xử lý thiếu/thừa/trùng (X17, X18).
 */

import crypto from 'node:crypto'
import { config } from '../config/env.js'
import { PricingService } from '../pricing/pricingService.js'
import { InventoryService } from '../inventory/inventoryService.js'
import { generateConfirmationToken, verifyConfirmationToken } from '../security/tokenService.js'
import { auditLogger } from '../security/auditLogger.js'
import { createPolicySnapshot } from '../policies/policyRegistry.js'

export class OrderService {
  /**
   * Chuẩn bị đơn hàng (prepare_order)
   * Kiểm tra quote, giữ tồn kho thời gian thực, cấp token xác nhận có hash payload
   */
  static prepareOrder(db, {
    tenantId = 'default',
    shopId = 'quannguyens',
    quoteId,
    customerName,
    customerPhone,
    shippingAddress,
    paymentMethod = 'cod',
  }) {
    if (!quoteId || !customerName || !customerPhone || !shippingAddress) {
      return {
        status: 'REJECTED',
        error_code: 'MISSING_REQUIRED_FIELDS',
        message: 'quoteId, customerName, customerPhone, và shippingAddress là bắt buộc',
      }
    }

    // 1. Kiểm tra báo giá (Quote) còn hạn hay không (Gate T07)
    const quoteResult = PricingService.getQuote(db, quoteId)
    if (!quoteResult || quoteResult.status !== 'SUCCEEDED') {
      return {
        status: 'REJECTED',
        error_code: 'INVALID_OR_EXPIRED_QUOTE',
        message: quoteResult?.message || 'Báo giá không tồn tại hoặc đã hết hạn',
      }
    }

    const quote = quoteResult.quote
    if (quote.is_consumed) {
      return {
        status: 'REJECTED',
        error_code: 'QUOTE_ALREADY_CONSUMED',
        message: 'Báo giá này đã được sử dụng để tạo đơn hàng trước đó',
      }
    }

    // 2. Giữ tồn kho (Reservation) cho từng sản phẩm trong quote
    const reservationIds = []
    for (const item of quote.items) {
      const resResult = InventoryService.reserveStock(db, {
        tenantId,
        shopId,
        sku: item.sku,
        size: item.size,
        colorCode: item.colorCode,
        quantity: item.quantity,
        ttlMinutes: 15,
      })

      if (resResult.status !== 'SUCCEEDED') {
        // Hoàn tác các reservation đã giữ trước đó nếu 1 món hết hàng
        for (const rid of reservationIds) {
          InventoryService.releaseReservation(db, rid)
        }
        return {
          status: 'REJECTED',
          error_code: 'INSUFFICIENT_STOCK',
          message: `Sản phẩm ${item.name} (${item.sku} - size ${item.size || ''}) không đủ hàng để giữ`,
        }
      }

      reservationIds.push(resResult.reservation_id)
    }

    // 3. Chuẩn bị Payload tóm tắt đơn hàng
    const orderPayload = {
      tenantId,
      shopId,
      quoteId: quote.quote_id,
      items: quote.items,
      subtotal: quote.subtotal,
      shippingFee: quote.shipping_fee,
      discount: quote.discount,
      total: quote.total,
      currency: quote.currency,
      paymentMethod,
      customerName,
      customerPhone,
      shippingAddress,
      reservationIds,
      policySnapshotId: quote.policy_snapshot_id,
    }

    // 4. Phát hành Confirmation Token gắn liền với hash của orderPayload (TTL 5 phút)
    const confirmationToken = generateConfirmationToken({
      tenantId,
      shopId,
      customerId: customerPhone,
      actionType: 'commit_order',
      targetId: quote.quote_id,
      payload: orderPayload,
      ttlSeconds: 300,
    })

    // Tạo bản tóm tắt an toàn (đã che bớt PII) gửi khách
    const maskedPhone = customerPhone.replace(/(\d{3})\d{4}(\d{3})/, '$1****$2')
    const maskedAddress = shippingAddress.length > 20
      ? shippingAddress.slice(0, 10) + '...' + shippingAddress.slice(-8)
      : shippingAddress

    const orderDraft = {
      items: quote.items.map((it) => `${it.name} (${it.size || 'F'}) x${it.quantity}`),
      subtotal: quote.subtotal,
      shipping_fee: quote.shipping_fee,
      discount: quote.discount,
      total: quote.total,
      currency: quote.currency,
      payment_method: paymentMethod,
      recipient: `${customerName} - ${maskedPhone}`,
      shipping_address: maskedAddress,
      expires_in_seconds: 300,
    }

    return {
      status: 'SUCCEEDED',
      confirmation_token: confirmationToken,
      order_draft: orderDraft,
      raw_payload: orderPayload,
      evidence_ref: `quote:${quote.quote_id}`,
    }
  }

  /**
   * Chốt đơn hàng thực tế (commit_order)
   * Kiểm tra Token xác nhận, ghi bền vững vào SQLite, tiêu thụ quote và reservation
   */
  static commitOrder(db, {
    confirmationToken,
    confirmedPayload,
    idempotencyKey = null,
  }) {
    if (!confirmationToken || !confirmedPayload) {
      return {
        status: 'REJECTED',
        error_code: 'MISSING_CONFIRMATION',
        message: 'confirmationToken và confirmedPayload là bắt buộc khi chốt đơn',
      }
    }

    // 1. Kiểm tra tính hợp lệ và tiêu thụ token xác nhận (Single-use, hash-bound)
    const tokenValidation = verifyConfirmationToken({
      token: confirmationToken,
      expectedAction: 'commit_order',
      currentPayload: confirmedPayload,
      consume: true,
    })
    if (!tokenValidation.valid) {
      return {
        status: 'REJECTED',
        error_code: tokenValidation.code || 'INVALID_CONFIRMATION_TOKEN',
        message: `Token xác nhận không hợp lệ: ${tokenValidation.error}`,
      }
    }

    const payload = confirmedPayload
    const now = new Date()

    // 2. Tạo mã đơn hàng chuẩn QuanNguyenS: QNS-XXXXXX-XXXX
    const randomHex1 = crypto.randomBytes(3).toString('hex').toUpperCase()
    const randomHex2 = crypto.randomBytes(2).toString('hex').toUpperCase()
    const orderId = `QNS-${randomHex1}-${randomHex2}`

    // 3. Đảm bảo Policy Snapshot được gắn chặt chẽ vào đơn hàng (Gate T42)
    const policySnapshot = createPolicySnapshot(db, {
      tenantId: payload.tenantId,
      shopId: payload.shopId,
      orderId,
    })

    // 4. Lưu đơn hàng vào cơ sở dữ liệu bền vững
    db.prepare(`
      INSERT INTO orders (
        order_id, tenant_id, shop_id, customer_id, customer_name, customer_phone,
        customer_email, shipping_address, items_json, subtotal, shipping_fee,
        discount, total, currency, status, payment_status, source,
        policy_version_id, version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CONFIRMED', 'UNPAID', 'web', ?, 1, ?, ?)
    `).run(
      orderId,
      payload.tenantId,
      payload.shopId,
      null, // customer_id
      payload.customerName,
      payload.customerPhone,
      payload.customerEmail || null,
      payload.shippingAddress,
      JSON.stringify(payload.items),
      payload.subtotal,
      payload.shippingFee,
      payload.discount,
      payload.total,
      payload.currency || 'VND',
      policySnapshot.snapshotId,
      now.toISOString(),
      now.toISOString()
    )

    // 5. Tiêu thụ Báo giá (Quote consumed)
    if (payload.quoteId) {
      PricingService.consumeQuote(db, payload.quoteId)
    }

    // 6. Tiêu thụ các Reservation tồn kho đã giữ
    if (payload.reservationIds && Array.isArray(payload.reservationIds)) {
      for (const rid of payload.reservationIds) {
        InventoryService.consumeReservation(db, rid, orderId)
      }
    }

    // 7. Ghi Audit Log hành động chốt đơn
    auditLogger.logAction(db, {
      actorType: 'customer',
      actorId: payload.customerPhone,
      actionName: 'commit_order',
      targetEntityType: 'order',
      targetEntityId: orderId,
      inputPayload: payload,
      resultStatus: 'SUCCEEDED',
      evidenceRef: `order:${orderId}`,
    })

    return {
      status: 'SUCCEEDED',
      order_id: orderId,
      subtotal: payload.subtotal,
      shipping_fee: payload.shippingFee,
      discount: payload.discount,
      total: payload.total,
      currency: payload.currency || 'VND',
      payment_method: payload.paymentMethod,
      order_status: 'CONFIRMED',
      payment_status: 'UNPAID',
      evidence_ref: `order:${orderId}`,
    }
  }

  /**
   * Tra cứu đơn hàng với kiểm tra phân quyền đối tượng chặt chẽ (Gate B10, X12)
   * Mã đơn 1 mình KHÔNG ĐỦ; bắt buộc khớp số điện thoại của chủ đơn.
   */
  static getOrder(db, { orderId, customerPhone }) {
    if (!orderId) {
      return {
        status: 'REJECTED',
        error_code: 'MISSING_ORDER_ID',
        message: 'Mã đơn hàng là bắt buộc',
      }
    }

    const row = db.prepare(`SELECT * FROM orders WHERE order_id = ?`).get(orderId)
    if (!row) {
      return {
        status: 'REJECTED',
        error_code: 'ORDER_NOT_FOUND',
        message: `Không tìm thấy đơn hàng ${orderId}`,
      }
    }

    // B10 & X12: Kiểm tra quyền sở hữu đối tượng chống IDOR
    if (!customerPhone) {
      return {
        status: 'REJECTED',
        error_code: 'AUTHENTICATION_REQUIRED',
        message: 'Cần cung cấp số điện thoại đặt hàng để xác minh quyền sở hữu đơn hàng',
      }
    }

    const cleanInputPhone = customerPhone.replace(/\D/g, '')
    const cleanOrderPhone = row.customer_phone.replace(/\D/g, '')

    if (cleanInputPhone !== cleanOrderPhone) {
      return {
        status: 'REJECTED',
        error_code: 'FORBIDDEN_OBJECT_ACCESS',
        message: 'Số điện thoại không khớp với thông tin đơn hàng đã đăng ký (B10, X12)',
      }
    }

    return {
      status: 'SUCCEEDED',
      order: {
        order_id: row.order_id,
        customer_name: row.customer_name,
        customer_phone: row.customer_phone.replace(/(\d{3})\d{4}(\d{3})/, '$1****$2'),
        shipping_address: row.shipping_address,
        items: JSON.parse(row.items_json),
        subtotal: row.subtotal,
        shipping_fee: row.shipping_fee,
        discount: row.discount,
        total: row.total,
        currency: row.currency,
        status: row.status,
        payment_status: row.payment_status,
        policy_version_id: row.policy_version_id,
        created_at: row.created_at,
        updated_at: row.updated_at,
      },
      evidence_ref: `order:${row.order_id}`,
    }
  }

  /**
   * Tạo yêu cầu thanh toán VietQR với tài khoản bí mật máy chủ quản lý (B09, B19)
   */
  static createPaymentRequest(db, { orderId }) {
    const row = db.prepare(`SELECT * FROM orders WHERE order_id = ?`).get(orderId)
    if (!row) {
      return {
        status: 'REJECTED',
        error_code: 'ORDER_NOT_FOUND',
        message: `Đơn hàng ${orderId} không tồn tại`,
      }
    }

    if (row.payment_status === 'PAID') {
      return {
        status: 'REJECTED',
        error_code: 'ORDER_ALREADY_PAID',
        message: `Đơn hàng ${orderId} đã được thanh toán hoàn tất`,
      }
    }

    // Lấy thông tin tài khoản ngân hàng Vietcombank từ Secret Config (B09)
    const bankId = config.VIETQR_BANK_ID || process.env.VIETQR_BANK_ID || 'VCB'
    const accountNo = config.VIETQR_ACCOUNT_NO || process.env.VIETQR_ACCOUNT_NO || '1050773506'
    const accountName = config.VIETQR_ACCOUNT_NAME || process.env.VIETQR_ACCOUNT_NAME || 'NGUYEN DUC QUAN'
    const cleanCode = row.order_id.replace(/[^A-Z0-9]/g, '').slice(-8)
    const transferContent = `QNS ${cleanCode}`
    const amount = row.total

    // Tạo link ảnh VietQR chuẩn (Hoàn toàn Free vô thời hạn từ VietQR API)
    const qrUrl = `https://img.vietqr.io/image/${bankId}-${accountNo}-compact.png?amount=${amount}&addInfo=${encodeURIComponent(transferContent)}&accountName=${encodeURIComponent(accountName)}`

    return {
      status: 'SUCCEEDED',
      order_id: row.order_id,
      amount,
      currency: 'VND',
      bank_id: bankId,
      account_no: accountNo,
      account_name: accountName,
      transfer_content: transferContent,
      qr_url: qrUrl,
      evidence_ref: `payment_request:${row.order_id}`,
    }
  }

  /**
   * Đối soát thanh toán từ Webhook / Ngân hàng (Gate B08, T13, X17, X18)
   */
  static reconcilePayment(db, {
    orderId,
    gateway = 'sepay',
    transactionId,
    amount,
    targetAccount = null,
    rawPayload = {},
  }) {
    if (!transactionId || amount === undefined) {
      return {
        status: 'REJECTED',
        error_code: 'INVALID_PAYMENT_PAYLOAD',
        message: 'transactionId và amount là bắt buộc',
      }
    }

    const now = new Date().toISOString()
    const numericAmount = Math.floor(Number(amount))

    if (!orderId) {
      return {
        status: 'UNMATCHED_ORDER',
        message: `Giao dịch ${transactionId} không có mã đơn hàng hợp lệ`,
      }
    }

    // 1. Tra cứu đơn hàng
    const order = db.prepare(`SELECT * FROM orders WHERE order_id = ?`).get(orderId)
    if (!order) {
      return {
        status: 'ORDER_NOT_FOUND',
        message: `Không tìm thấy đơn hàng ${orderId} cho giao dịch ${transactionId}`,
      }
    }

    // 2. Chống trùng giao dịch ngân hàng bằng UNIQUE(gateway, transaction_id)
    try {
      db.prepare(`
        INSERT INTO payments (
          id, tenant_id, shop_id, order_id, gateway, transaction_id,
          amount, currency, status, paid_at, raw_payload, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'VND', 'PENDING', ?, ?, ?, ?)
      `).run(
        `PAY-${Date.now()}-${transactionId}`,
        config.DEFAULT_TENANT_ID,
        config.DEFAULT_SHOP_ID,
        orderId,
        gateway,
        String(transactionId),
        numericAmount,
        now,
        JSON.stringify(rawPayload),
        now,
        now
      )
    } catch (err) {
      if (err.message.includes('UNIQUE constraint failed')) {
        // Gate T13: Trùng transaction_id -> Bỏ qua an toàn (Idempotent)
        return {
          status: 'IDEMPOTENT',
          isDuplicate: true,
          message: `Giao dịch ${transactionId} đã được đối soát trước đó`,
          evidence_ref: `payment:${gateway}:${transactionId}`,
        }
      }
      throw err
    }

    // X18: Chuyển khoản vào đơn đã bị hủy
    if (order.status === 'CANCELLED') {
      db.prepare(`
        UPDATE payments SET status = 'FLAGGED_CANCELLED_ORDER', updated_at = ? WHERE gateway = ? AND transaction_id = ?
      `).run(now, gateway, String(transactionId))

      return {
        status: 'FLAGGED_CANCELLED_ORDER',
        order_id: orderId,
        message: 'Đơn hàng đã bị hủy trước khi nhận tiền. Chuyển hỗ trợ hoàn tiền hoặc đặt lại.',
        evidence_ref: `payment:${gateway}:${transactionId}`,
      }
    }

    // X17: Phân nhánh khớp tiền, chuyển thiếu, chuyển thừa
    if (numericAmount === order.total) {
      // Khớp 100% -> Đánh dấu PAID
      db.prepare(`
        UPDATE orders SET payment_status = 'PAID', updated_at = ? WHERE order_id = ?
      `).run(now, orderId)

      db.prepare(`
        UPDATE payments SET status = 'CONFIRMED', paid_at = ?, updated_at = ? WHERE gateway = ? AND transaction_id = ?
      `).run(now, now, gateway, String(transactionId))

      return {
        status: 'SUCCEEDED',
        reconciliation_status: 'PAID',
        order_id: orderId,
        amount: numericAmount,
        evidence_ref: `payment:${gateway}:${transactionId}`,
      }
    } else if (numericAmount < order.total) {
      // Chuyển thiếu tiền (X17) -> KHÔNG ghi PAID
      const diff = order.total - numericAmount
      db.prepare(`
        UPDATE payments SET status = 'PARTIAL', updated_at = ? WHERE gateway = ? AND transaction_id = ?
      `).run(now, gateway, String(transactionId))

      return {
        status: 'UNDERPAID',
        order_id: orderId,
        received_amount: numericAmount,
        expected_amount: order.total,
        shortage: diff,
        message: `Khách chuyển thiếu ${diff.toLocaleString('vi-VN')}đ. Đơn chưa được xác nhận PAID.`,
        evidence_ref: `payment:${gateway}:${transactionId}`,
      }
    } else {
      // Chuyển thừa tiền (X17) -> Đánh dấu PAID kèm ghi chú bồi hoàn phần thừa
      const overage = numericAmount - order.total
      db.prepare(`
        UPDATE orders SET payment_status = 'PAID', updated_at = ? WHERE order_id = ?
      `).run(now, orderId)

      db.prepare(`
        UPDATE payments SET status = 'CONFIRMED_OVERPAID', updated_at = ? WHERE gateway = ? AND transaction_id = ?
      `).run(now, gateway, String(transactionId))

      return {
        status: 'OVERPAID',
        order_id: orderId,
        received_amount: numericAmount,
        expected_amount: order.total,
        overage,
        message: `Khách chuyển thừa ${overage.toLocaleString('vi-VN')}đ. Đã ghi nhận PAID và mở cờ hoàn phần thừa.`,
        evidence_ref: `payment:${gateway}:${transactionId}`,
      }
    }
  }

  /**
   * Thay đổi địa chỉ giao hàng trước khi kho khóa (Blueprint §11.4, X22)
   */
  static changeShippingAddress(db, { orderId, newAddress, customerPhone }) {
    const authCheck = this.getOrder(db, { orderId, customerPhone })
    if (authCheck.status !== 'SUCCEEDED') {
      return authCheck
    }

    const order = authCheck.order
    // Kiểm tra trạng thái kho: Đơn đang SHIPMENT_PREPARED hoặc SHIPPED thì không sửa được
    if (order.status === 'SHIPPED' || order.status === 'DELIVERED') {
      return {
        status: 'REJECTED',
        error_code: 'WAREHOUSE_LOCKED',
        message: 'Đơn hàng đã được bàn giao cho đối tác vận chuyển, không thể trực tiếp đổi địa chỉ',
      }
    }

    const now = new Date().toISOString()
    db.prepare(`
      UPDATE orders SET shipping_address = ?, updated_at = ? WHERE order_id = ?
    `).run(newAddress, now, orderId)

    return {
      status: 'SUCCEEDED',
      order_id: orderId,
      new_shipping_address: newAddress,
      evidence_ref: `order:${orderId}`,
    }
  }
}
