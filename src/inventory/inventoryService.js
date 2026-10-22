/**
 * INVENTORY & STOCK RESERVATION SERVICE (Blueprint §10.2, §11.2, Gates T02, T11)
 * 
 * - Kiểm tra tồn kho thời gian thực.
 * - Giữ hàng nguyên tử (Atomic Reservation) có TTL thực tế, chống bán vượt tồn kho (overselling).
 * - Giải phóng hoặc tiêu thụ phiếu giữ hàng khi đơn được chốt.
 */

import crypto from 'node:crypto'
import { getProductBySkuOrSlug } from '../catalog/products.js'

export class InventoryService {
  /**
   * Kiểm tra số lượng tồn kho khả dụng thực tế
   */
  static checkAvailability(db, {
    sku,
    size = null,
    colorCode = null,
    quantity = 1,
  }) {
    const product = getProductBySkuOrSlug(sku)
    if (!product) {
      return {
        status: 'REJECTED',
        error_code: 'PRODUCT_NOT_FOUND',
        available: false,
        availableStock: 0,
        message: `Sản phẩm ${sku} không tồn tại trong danh mục`,
      }
    }

    // Xác định số lượng trong danh mục cơ sở
    let baseStock = 0
    let variantFound = false

    for (const v of product.variants) {
      if (colorCode && v.colorCode !== colorCode) continue

      for (const s of v.sizes) {
        if (size && s.size.toUpperCase() !== size.toUpperCase()) continue
        variantFound = true
        baseStock += s.stock || 0
      }
    }

    if (!variantFound && (size || colorCode)) {
      return {
        status: 'SUCCEEDED',
        available: false,
        availableStock: 0,
        totalStock: 0,
        reservedStock: 0,
        message: `Biến thể size ${size || ''} màu ${colorCode || ''} hiện không có sẵn`,
      }
    }

    // Tính toán số lượng đang bị giữ trong các reservation chưa hết hạn
    const now = new Date().toISOString()
    const reservationKey = size ? `${product.sku}:${size.toUpperCase()}` : product.sku

    const reservedRow = db.prepare(`
      SELECT SUM(quantity) as total_reserved
      FROM reservations
      WHERE sku = ? AND status = 'ACTIVE' AND expires_at > ?
    `).get(reservationKey, now)

    const reservedStock = reservedRow?.total_reserved || 0
    const availableStock = Math.max(0, baseStock - reservedStock)
    const isAvailable = availableStock >= quantity

    return {
      status: 'SUCCEEDED',
      sku: product.sku,
      size,
      colorCode,
      available: isAvailable,
      availableStock,
      totalStock: baseStock,
      reservedStock,
      requestedQuantity: quantity,
      message: isAvailable
        ? `Còn ${availableStock} sản phẩm khả dụng`
        : `Chỉ còn ${availableStock} sản phẩm khả dụng (yêu cầu ${quantity})`,
    }
  }

  /**
   * Giữ hàng có thời hạn (Atomic Reservation)
   */
  static reserveStock(db, {
    tenantId = 'default',
    shopId = 'quannguyens',
    sku,
    size = null,
    colorCode = null,
    quantity = 1,
    ttlMinutes = 15,
  }) {
    const check = this.checkAvailability(db, { sku, size, colorCode, quantity })
    if (!check.available) {
      return {
        status: 'REJECTED',
        error_code: 'INSUFFICIENT_STOCK',
        availableStock: check.availableStock,
        message: `Không đủ hàng để giữ. Hiện khả dụng: ${check.availableStock}, yêu cầu: ${quantity}`,
      }
    }

    const reservationKey = size ? `${check.sku}:${size.toUpperCase()}` : check.sku
    const reservationId = `RES-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`
    const now = new Date()
    const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000).toISOString()

    db.prepare(`
      INSERT INTO reservations (
        id, reservation_id, tenant_id, shop_id, sku, quantity,
        status, expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)
    `).run(
      reservationId,
      reservationId,
      tenantId,
      shopId,
      reservationKey,
      quantity,
      expiresAt,
      now.toISOString(),
      now.toISOString()
    )

    return {
      status: 'SUCCEEDED',
      reservation_id: reservationId,
      sku: check.sku,
      size,
      quantity,
      expires_at: expiresAt,
      ttl_minutes: ttlMinutes,
      evidence_ref: `reservation:${reservationId}`,
    }
  }

  /**
   * Tiêu thụ phiếu giữ hàng khi chốt đơn thành công
   */
  static consumeReservation(db, reservationId, orderId) {
    const now = new Date().toISOString()
    const info = db.prepare(`
      UPDATE reservations
      SET status = 'CONSUMED', order_id = ?, updated_at = ?
      WHERE reservation_id = ? AND status = 'ACTIVE'
    `).run(orderId, now, reservationId)

    return info.changes > 0
  }

  /**
   * Giải phóng phiếu giữ hàng khi khách hủy hoặc hết hạn
   */
  static releaseReservation(db, reservationId) {
    const now = new Date().toISOString()
    const info = db.prepare(`
      UPDATE reservations
      SET status = 'RELEASED', updated_at = ?
      WHERE reservation_id = ? AND status = 'ACTIVE'
    `).run(now, reservationId)

    return info.changes > 0
  }
}
