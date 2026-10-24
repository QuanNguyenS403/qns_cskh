/**
 * CASES, RMA, CARRIER TRACKING & PROMISES SERVICE (Blueprint §12, §13, §14, Gates T23-T30, X23-X26)
 * 
 * - Quản lý máy trạng thái Case khiếu nại / hỗ trợ.
 * - RMA Đổi / Trả hàng: Đọc hạn và điều kiện theo SNAPSHOT của đơn (T42), xử lý lỗi/hết size đổi (X23, X24).
 * - Hoàn tiền (Refund): Kiểm tra trần hoàn tiền, chặn hoàn sang tài khoản khác khi chưa duyệt (X26).
 * - Vận đơn & sự cố giao hàng: Xử lý scan "đã giao" nhưng khách chưa nhận (V6), mở case P1.
 */

import crypto from 'node:crypto'
import { getApplicableOrderPolicy, POLICY_TYPES } from '../policies/policyRegistry.js'
import { OrderService } from '../orders/orderService.js'
import { InventoryService } from '../inventory/inventoryService.js'

export class CaseService {
  /**
   * Mở hồ sơ yêu cầu hỗ trợ / khiếu nại (create_service_case)
   */
  static createCase(db, {
    tenantId = 'default',
    shopId = 'quannguyens',
    orderId = null,
    customerId = null,
    issueType, // 'DEFECTIVE_PRODUCT' | 'WRONG_ITEM' | 'SIZE_EXCHANGE' | 'DELIVERY_DISPUTE' | 'REFUND_REQUEST' | 'OTHER'
    summary,
    priority = 'P2', // P0 | P1 | P2 | P3
    ownerRole = 'cs_agent',
    ownerId = null,
  }) {
    if (!issueType || !summary) {
      throw new Error('issueType và summary là bắt buộc khi tạo Case')
    }

    const caseId = `CASE-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`
    const now = new Date().toISOString()

    db.prepare(`
      INSERT INTO cases (
        id, tenant_id, shop_id, order_id, customer_id, issue_type,
        priority, status, owner_role, owner_id, summary, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, ?)
    `).run(
      caseId,
      tenantId,
      shopId,
      orderId,
      customerId,
      issueType,
      priority,
      ownerRole,
      ownerId,
      summary,
      now,
      now
    )

    return {
      status: 'SUCCEEDED',
      case_id: caseId,
      order_id: orderId,
      issue_type: issueType,
      priority,
      case_status: 'OPEN',
      owner_role: ownerRole,
      summary,
      created_at: now,
      evidence_ref: `case:${caseId}`,
    }
  }

  /**
   * Chuẩn bị đổi trả hàng (prepare_return_exchange)
   * Kiểm tra điều kiện theo snapshot chính sách của đơn hàng (T42, X23, X24)
   */
  static prepareReturnExchange(db, {
    orderId,
    customerPhone,
    reasonType, // 'DEFECTIVE' | 'SIZE_EXCHANGE' | 'CHANGE_MIND'
    requestedSize = null,
    replacementSku = null,
  }) {
    // 1. Kiểm tra quyền sở hữu đơn hàng
    const orderRes = OrderService.getOrder(db, { orderId, customerPhone })
    if (orderRes.status !== 'SUCCEEDED') {
      return orderRes
    }
    const order = orderRes.order

    // 2. Lấy điều kiện đổi trả theo Snapshot chính sách của đơn hàng đó (Gate T42)
    const policyResult = getApplicableOrderPolicy(db, {
      orderId,
      policyType: POLICY_TYPES.RETURNS,
    })
    const returnPolicy = policyResult?.policy?.content || {
      exchangeWindowDays: 7,
      returnWindowDays: 7,
      shippingFeePayer: { defectiveOrWrongItem: 'shop_pays_100', sizeExchangePreference: 'customer_or_shared' },
    }

    // 3. Kiểm tra thời hạn đổi trả
    const orderDate = new Date(order.created_at)
    const daysSinceOrder = Math.floor((Date.now() - orderDate.getTime()) / (1000 * 60 * 60 * 24))

    if (reasonType === 'CHANGE_MIND' && daysSinceOrder > returnPolicy.returnWindowDays) {
      return {
        status: 'REJECTED',
        error_code: 'RETURN_WINDOW_EXPIRED',
        daysSinceOrder,
        allowedDays: returnPolicy.returnWindowDays,
        message: `Đơn hàng đã quá hạn đổi trả ${returnPolicy.returnWindowDays} ngày theo chính sách cam kết của đơn (T42, X25)`,
      }
    }

    // 4. Nếu là đổi size: Kiểm tra xem size thay thế còn hàng không (X24)
    let replacementAvailability = null
    if (reasonType === 'SIZE_EXCHANGE' && requestedSize) {
      const skuToCheck = replacementSku || order.items[0]?.sku
      replacementAvailability = InventoryService.checkAvailability(db, {
        sku: skuToCheck,
        size: requestedSize,
        quantity: 1,
      })

      if (!replacementAvailability.available) {
        // X24: Hết size thay thế -> Đưa ra các lựa chọn thực tế, không tự tiện đổi mẫu
        return {
          status: 'SIZE_OUT_OF_STOCK',
          sku: skuToCheck,
          requested_size: requestedSize,
          message: `Rất tiếc size ${requestedSize} của mẫu này hiện đang tạm hết hàng. Shop có các lựa chọn: (1) Chờ đợt hàng mới, (2) Đổi sang mẫu khác bằng giá, hoặc (3) Trả hàng hoàn tiền theo chính sách ạ. (X24)`,
          evidence_ref: `order:${orderId}`,
        }
      }
    }

    // 5. Xác định ai chịu phí vận chuyển
    let feePayer = 'customer_or_shared'
    let mandatoryCarrier = null
    let shippingNote = null
    if (reasonType === 'DEFECTIVE' || reasonType === 'WRONG_ITEM') {
      feePayer = 'shop_pays_100' // Hàng lỗi shop chịu 100% phí ship 2 chiều khi hoàn qua Viettel Post (X23)
      mandatoryCarrier = 'Viettel Post'
      shippingNote = 'Bắt buộc hoàn sản phẩm theo đơn vị vận chuyển Viettel Post, nếu sử dụng đơn vị vận chuyển khác thì shop xin phép thu phí ship của bạn.'
    }

    return {
      status: 'SUCCEEDED',
      order_id: orderId,
      reason_type: reasonType,
      fee_payer: feePayer,
      mandatory_return_carrier: mandatoryCarrier,
      shipping_note: shippingNote,
      policy_snapshot_source: policyResult.source,
      allowed_days: returnPolicy.exchangeWindowDays,
      replacement_size: requestedSize,
      evidence_ref: `order:${orderId}`,
    }
  }

  /**
   * Tạo yêu cầu hoàn tiền có kiểm soát trần và chống gian lận (prepare_refund / commit_refund) (X26)
   */
  static prepareRefund(db, {
    orderId,
    customerPhone,
    refundAmount,
    destinationAccount,
    reason,
  }) {
    const orderRes = OrderService.getOrder(db, { orderId, customerPhone })
    if (orderRes.status !== 'SUCCEEDED') {
      return orderRes
    }
    const order = orderRes.order

    const amount = Math.floor(Number(refundAmount))
    if (amount <= 0 || amount > order.total) {
      return {
        status: 'REJECTED',
        error_code: 'INVALID_REFUND_AMOUNT',
        message: `Số tiền hoàn không hợp lệ (Tối đa ${order.total.toLocaleString('vi-VN')}đ)`,
      }
    }

    // X26: Hoàn tiền sang tài khoản khác với tài khoản nguồn -> Yêu cầu xác minh tăng cường / quản lý duyệt
    const isDifferentAccount = destinationAccount && !destinationAccount.isOriginalSource
    if (isDifferentAccount) {
      const caseRes = this.createCase(db, {
        orderId,
        customerId: customerPhone,
        issueType: 'REFUND_REQUEST',
        summary: `Yêu cầu hoàn ${amount.toLocaleString('vi-VN')}đ sang tài khoản khác nguồn. Cần xác minh tăng cường (X26).`,
        priority: 'P1',
        ownerRole: 'cs_manager',
      })

      return {
        status: 'REQUIRES_ENHANCED_VERIFICATION',
        case_id: caseRes.case_id,
        message: 'Hoàn tiền sang tài khoản khác cần xác minh chính chủ và được quản lý duyệt. Agent không tự động hoàn tiền trực tiếp (X26).',
        evidence_ref: `case:${caseRes.case_id}`,
      }
    }

    const refundId = `REF-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`
    return {
      status: 'SUCCEEDED',
      refund_id: refundId,
      order_id: orderId,
      amount,
      currency: 'VND',
      evidence_ref: `refund:${refundId}`,
    }
  }

  /**
   * Tra cứu vận đơn và xử lý sự cố giao nhận (Blueprint §8.8, V6, X21)
   */
  static getTracking(db, { orderId, customerReportNotReceived = false }) {
    const shipment = db.prepare(`SELECT * FROM shipments WHERE order_id = ? ORDER BY created_at DESC LIMIT 1`).get(orderId)

    if (!shipment) {
      return {
        status: 'SUCCEEDED',
        order_id: orderId,
        tracking_status: 'PROCESSING_AT_WAREHOUSE',
        carrier: 'Viettel Post',
        message: 'Đơn hàng đang được chuẩn bị tại kho, chưa xuất mã vận đơn đối tác',
        evidence_ref: `order:${orderId}`,
      }
    }

    // Sự cố: Hệ thống scan "DELIVERED" nhưng khách khiếu nại CHƯA nhận được hàng (Blueprint §8.8, V6)
    if (shipment.status === 'DELIVERED' && customerReportNotReceived) {
      const disputeCase = this.createCase(db, {
        orderId,
        issueType: 'DELIVERY_DISPUTE',
        priority: 'P1',
        summary: `Khách báo chưa nhận được hàng dù vận đơn ${shipment.tracking_code} đã scan phát thành công (V6).`,
        ownerRole: 'carrier_liaison',
      })

      return {
        status: 'DISPUTE_OPENED',
        order_id: orderId,
        case_id: disputeCase.case_id,
        tracking_code: shipment.tracking_code,
        carrier: shipment.carrier,
        message: `QuanNguyenS đã ghi nhận sự cố chưa nhận được kiện hàng dù hệ thống có scan đã giao. QuanNguyenS đã mở ngay yêu cầu ưu tiên ${disputeCase.case_id} để đối soát với Viettel Post. Bạn không cần tự liên hệ nhiều bên ạ.`,
        evidence_ref: `case:${disputeCase.case_id}`,
      }
    }

    return {
      status: 'SUCCEEDED',
      order_id: orderId,
      tracking_code: shipment.tracking_code,
      carrier: shipment.carrier,
      tracking_status: shipment.status,
      shipped_at: shipment.shipped_at,
      delivered_at: shipment.delivered_at,
      evidence_ref: `shipment:${shipment.tracking_code}`,
    }
  }

  /**
   * Tạo lời hứa có bản ghi cam kết và thời hạn hoàn thành (Blueprint §13, Gate B13)
   */
  static createPromise(db, {
    tenantId = 'default',
    shopId = 'quannguyens',
    caseId = null,
    orderId = null,
    customerId = null,
    promiseText,
    dueAt, // ISO-8601 string
    ownerRole = 'workflow',
    ownerId = null,
  }) {
    if (!promiseText || !dueAt) {
      throw new Error('promiseText và dueAt là bắt buộc')
    }

    const promiseId = `PRM-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`
    const now = new Date().toISOString()

    db.prepare(`
      INSERT INTO promises (
        id, tenant_id, shop_id, case_id, order_id, customer_id,
        promise_text, due_at, owner_role, owner_id, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)
    `).run(
      promiseId,
      tenantId,
      shopId,
      caseId,
      orderId,
      customerId,
      promiseText,
      dueAt,
      ownerRole,
      ownerId,
      now,
      now
    )

    return {
      status: 'SUCCEEDED',
      promise_id: promiseId,
      case_id: caseId,
      order_id: orderId,
      promise_text: promiseText,
      due_at: dueAt,
      owner_role: ownerRole,
      evidence_ref: `promise:${promiseId}`,
    }
  }
}
