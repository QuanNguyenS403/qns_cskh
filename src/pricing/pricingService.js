/**
 * PRICING SERVICE & QUOTE ENGINE (Blueprint §8.1, B03, B04, T05, T08)
 * 
 * - Server-side duy nhất tính toán tiền, phí ship, chiết khấu.
 * - Mọi con số tiền là SỐ NGUYÊN VND (integer), không float, không làm tròn sai số.
 * - Freeship được đánh giá trên tổng sau khi trừ chiết khấu (T08).
 * - Chiết khấu chuyển khoản chỉ áp dụng khi có chính sách PRICING đã APPROVED (B04).
 * - Sinh báo giá (Quote) có TTL, version, snapshot chính sách đi kèm, lưu vào CSDL.
 */

import crypto from 'node:crypto'
import { getProductBySkuOrSlug } from '../catalog/products.js'
import { getApprovedPolicy, createPolicySnapshot, POLICY_TYPES } from '../policies/policyRegistry.js'

export class PricingService {
  /**
   * Tính toán báo giá chuẩn xác (Server-side Quote)
   * 
   * @param {DatabaseSync} db Kết nối CSDL
   * @param {Object} params Tham số báo giá
   * @param {string} params.tenantId
   * @param {string} params.shopId
   * @param {Array<{sku: string, size?: string, colorCode?: string, quantity: number}>} params.items
   * @param {'cod'|'bank_transfer'} [params.paymentMethod='cod']
   * @param {string} [params.shippingProvince=null]
   * @param {string} [params.promoCode=null]
   * @returns {Object} Quote Envelope
   */
  static calculateQuote(db, {
    tenantId = 'default',
    shopId = 'quannguyens',
    items = [],
    paymentMethod = 'cod',
    shippingProvince = null,
    promoCode = null,
  }) {
    if (!items || items.length === 0) {
      return {
        status: 'REJECTED',
        error_code: 'EMPTY_ITEMS',
        message: 'Danh sách sản phẩm báo giá không được rỗng',
        evidence_ref: null,
      }
    }

    // 1. Kiểm tra chính sách giá & vận chuyển hiện hành (ĐÃ DUYỆT)
    const pricingPolicy = getApprovedPolicy(db, { shopId, policyType: POLICY_TYPES.PRICING })
    const shippingPolicy = getApprovedPolicy(db, { shopId, policyType: POLICY_TYPES.SHIPPING })

    const pricingRulesApplied = []

    // 2. Định giá từng sản phẩm và tính Subtotal (nguyên VND)
    let subtotal = 0
    const quoteItems = []

    for (const item of items) {
      const product = getProductBySkuOrSlug(item.sku)
      if (!product) {
        return {
          status: 'REJECTED',
          error_code: 'PRODUCT_NOT_FOUND',
          message: `Không tìm thấy sản phẩm có mã hoặc SKU: ${item.sku}`,
          evidence_ref: null,
        }
      }

      const qty = Math.max(1, parseInt(item.quantity, 10) || 1)
      const unitPrice = Math.floor(product.price)
      const lineTotal = unitPrice * qty
      subtotal += lineTotal

      quoteItems.push({
        sku: product.sku,
        name: product.name,
        size: item.size || null,
        colorCode: item.colorCode || null,
        unitPrice,
        quantity: qty,
        lineTotal,
      })
    }

    // 3. Tính chiết khấu (Discount)
    let discount = 0
    if (paymentMethod === 'bank_transfer') {
      const discountPct = pricingPolicy?.content?.bankTransferDiscountPct || 0
      if (discountPct > 0) {
        // Làm tròn số nguyên VND
        const bankDiscount = Math.floor((subtotal * discountPct) / 100)
        discount += bankDiscount
        pricingRulesApplied.push({
          rule: 'BANK_TRANSFER_DISCOUNT',
          percent: discountPct,
          amount: bankDiscount,
          policyVersion: pricingPolicy.version,
        })
      }
    }

    const discountedSubtotal = Math.max(0, subtotal - discount)

    // 4. Tính phí vận chuyển (Shipping Fee) - Phải tính sau giảm (Gate T08)
    const standardFee = shippingPolicy?.content?.standardShippingFee ?? 30000
    const freeshipThreshold = shippingPolicy?.content?.freeshipThreshold ?? 500000

    let shippingFee = standardFee

    // Gate T08: Kiểm tra điều kiện Freeship trên discountedSubtotal (sau khi trừ chiết khấu)
    if (discountedSubtotal >= freeshipThreshold) {
      shippingFee = 0
      pricingRulesApplied.push({
        rule: 'FREESHIP_THRESHOLD_MET',
        threshold: freeshipThreshold,
        discountedSubtotal,
        policyVersion: shippingPolicy?.version || 'default',
      })
    } else {
      pricingRulesApplied.push({
        rule: 'STANDARD_SHIPPING',
        fee: standardFee,
        freeshipThreshold,
        policyVersion: shippingPolicy?.version || 'default',
      })
    }

    // 5. Tổng tiền cuối cùng (Số nguyên VND)
    const total = discountedSubtotal + shippingFee

    // 6. TTL hiệu lực báo giá
    const ttlMinutes = pricingPolicy?.content?.quoteTtlMinutes || 30
    const now = new Date()
    const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000).toISOString()
    const quoteId = `QTE-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`

    // 7. Tạo policy snapshot gắn kèm quote
    const snapshot = createPolicySnapshot(db, { tenantId, shopId, quoteId })

    // 8. Lưu vào bảng quotes
    db.prepare(`
      INSERT INTO quotes (
        id, quote_id, tenant_id, shop_id, items_json,
        subtotal, shipping_fee, discount, total, currency,
        policy_snapshot_id, pricing_rules_applied_json, expires_at, is_consumed, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    `).run(
      quoteId,
      quoteId,
      tenantId,
      shopId,
      JSON.stringify(quoteItems),
      subtotal,
      shippingFee,
      discount,
      total,
      'VND',
      snapshot.snapshotId,
      JSON.stringify(pricingRulesApplied),
      expiresAt,
      now.toISOString()
    )

    return {
      status: 'SUCCEEDED',
      quote_id: quoteId,
      items: quoteItems,
      subtotal,
      discount,
      shipping_fee: shippingFee,
      total,
      currency: 'VND',
      payment_method: paymentMethod,
      shipping_province: shippingProvince,
      pricing_rules_applied: pricingRulesApplied,
      policy_snapshot_id: snapshot.snapshotId,
      expires_at: expiresAt,
      evidence_ref: `quote:${quoteId}`,
    }
  }

  /**
   * Lấy và kiểm tra báo giá theo quote_id
   * Kiểm tra xem còn hạn hay đã hết hạn hoặc đã được sử dụng (Gate T07)
   */
  static getQuote(db, quoteId) {
    if (!quoteId) return null

    const row = db.prepare(`SELECT * FROM quotes WHERE quote_id = ?`).get(quoteId)
    if (!row) {
      return {
        status: 'REJECTED',
        error_code: 'QUOTE_NOT_FOUND',
        message: `Báo giá ${quoteId} không tồn tại`,
        evidence_ref: null,
      }
    }

    const now = new Date()
    const expiresAt = new Date(row.expires_at)
    const isExpired = now > expiresAt

    if (isExpired) {
      return {
        status: 'EXPIRED',
        error_code: 'QUOTE_EXPIRED',
        message: `Báo giá ${quoteId} đã hết hạn vào ${row.expires_at}`,
        quote: {
          quote_id: row.quote_id,
          subtotal: row.subtotal,
          total: row.total,
          expires_at: row.expires_at,
          is_consumed: Boolean(row.is_consumed),
        },
        evidence_ref: `quote:${quoteId}`,
      }
    }

    return {
      status: 'SUCCEEDED',
      quote: {
        quote_id: row.quote_id,
        tenant_id: row.tenant_id,
        shop_id: row.shop_id,
        items: JSON.parse(row.items_json),
        subtotal: row.subtotal,
        shipping_fee: row.shipping_fee,
        discount: row.discount,
        total: row.total,
        currency: row.currency,
        policy_snapshot_id: row.policy_snapshot_id,
        pricing_rules_applied: JSON.parse(row.pricing_rules_applied_json || '[]'),
        expires_at: row.expires_at,
        is_consumed: Boolean(row.is_consumed),
        created_at: row.created_at,
      },
      evidence_ref: `quote:${row.quote_id}`,
    }
  }

  /**
   * Đánh dấu quote đã được chốt thành đơn hàng (consumed)
   */
  static consumeQuote(db, quoteId) {
    const info = db.prepare(`
      UPDATE quotes SET is_consumed = 1 WHERE quote_id = ? AND is_consumed = 0
    `).run(quoteId)
    return info.changes > 0
  }
}
