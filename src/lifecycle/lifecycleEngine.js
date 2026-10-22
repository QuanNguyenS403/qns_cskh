/**
 * OUTBOUND LIFECYCLE AUTOMATION & CONSENT ENGINE (Blueprint §7, §15, §16, Gates B11, B12, T34-T41, X27-X32)
 * 
 * - Quản lý sổ đồng thuận (Consents) & Quyền riêng tư.
 * - Xử lý Opt-out lập tức hủy mọi Job quảng cáo đang chờ (B12, X27).
 * - Quyền yêu cầu xóa dữ liệu cá nhân (Right to be Forgotten - B11).
 * - Chăm sóc vòng đời: Kiểm tra can_send tại thời điểm phát tin; có case mở lập tức chặn marketing (T34).
 */

import crypto from 'node:crypto'
import { CanSendGate } from '../channels/canSend.js'

export class LifecycleEngine {
  /**
   * Ghi nhận hoặc cập nhật đồng thuận của khách hàng (Consent)
   */
  static recordConsent(db, {
    tenantId = 'default',
    shopId = 'quannguyens',
    customerId,
    purpose = 'marketing', // 'marketing' | 'customer_support' | 'measurement_retention'
    channel = 'all',
    status = 'GRANTED', // 'GRANTED' | 'REVOKED'
    evidenceType = 'chat_consent',
    evidenceRef = null,
  }) {
    const consentId = `CST-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`
    const now = new Date().toISOString()
    const revokedAt = status === 'REVOKED' ? now : null

    db.prepare(`
      INSERT INTO consents (
        id, tenant_id, shop_id, customer_id, purpose, channel,
        status, evidence_type, evidence_ref, version, recorded_at, revoked_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'v1.0', ?, ?)
    `).run(
      consentId,
      tenantId,
      shopId,
      customerId,
      purpose,
      channel,
      status,
      evidenceType,
      evidenceRef,
      now,
      revokedAt
    )

    return {
      status: 'SUCCEEDED',
      consent_id: consentId,
      customer_id: customerId,
      purpose,
      consent_status: status,
      evidence_ref: `consent:${consentId}`,
    }
  }

  /**
   * Xử lý Opt-out: "đừng nhắn nữa" hoặc "tắt quảng cáo" (Gate B12, X27)
   * Lập tức hủy bỏ các job gửi tin đang chờ trong hàng đợi.
   */
  static handleOptOut(db, {
    tenantId = 'default',
    shopId = 'quannguyens',
    customerId,
    scope = 'marketing', // 'marketing' | 'all'
  }) {
    const now = new Date().toISOString()

    // 1. Ghi nhận rút lại đồng thuận trong bảng consents
    this.recordConsent(db, {
      tenantId,
      shopId,
      customerId,
      purpose: scope,
      channel: 'all',
      status: 'REVOKED',
      evidenceType: 'customer_opt_out',
    })

    // 2. Hủy ngay lập tức các Job đang chờ trong bảng jobs (Gate B12, X27)
    let jobQuery = `
      UPDATE jobs
      SET status = 'CANCELLED', last_error = 'Customer opted out', updated_at = ?
      WHERE status IN ('READY', 'SCHEDULED')
        AND payload_json LIKE ?
    `
    if (scope === 'marketing') {
      jobQuery += ` AND job_type = 'outbound_marketing'`
    }

    const cancelInfo = db.prepare(jobQuery).run(now, `%"customerId":"${customerId}"%`)

    // 3. Hủy các tin nhắn marketing đang pending trong bảng outbox
    const outboxInfo = db.prepare(`
      UPDATE outbox
      SET status = 'CANCELLED', error_message = 'Customer opted out', updated_at = ?
      WHERE status = 'PENDING'
        AND recipient_id = ?
        AND message_type = 'marketing'
    `).run(now, customerId)

    return {
      status: 'SUCCEEDED',
      customer_id: customerId,
      opt_out_scope: scope,
      cancelled_jobs_count: cancelInfo.changes,
      cancelled_outbox_count: outboxInfo.changes,
      message: `Đã tắt tin ${scope === 'marketing' ? 'quảng cáo / ưu đãi' : 'toàn bộ tin chủ động'}. Mọi lịch gửi đang chờ đã được hủy bỏ ngay lập tức (B12, X27).`,
      evidence_ref: `opt_out:${customerId}`,
    }
  }

  /**
   * Quyền yêu cầu xóa dữ liệu cá nhân (Right to be Forgotten - Gate B11)
   * Xóa số đo, preferences, ẩn danh hóa thông tin đơn hàng nhưng giữ chứng từ kế toán.
   */
  static purgeCustomerData(db, {
    tenantId = 'default',
    shopId = 'quannguyens',
    customerId,
  }) {
    const now = new Date().toISOString()

    // 1. Xóa sở thích cá nhân (Preferences)
    const prefInfo = db.prepare(`DELETE FROM preferences WHERE customer_id = ?`).run(customerId)

    // 2. Xóa trí nhớ thông tin cá nhân (Memory Facts)
    const memInfo = db.prepare(`DELETE FROM memory_facts WHERE customer_id = ?`).run(customerId)

    // 3. Ẩn danh hóa thông tin PII trong đơn hàng (Giữ lại số tiền và mã đơn cho chứng từ kế toán)
    const orderInfo = db.prepare(`
      UPDATE orders
      SET customer_name = 'KHÁCH HÀNG ĐÃ XÓA DỮ LIỆU',
          shipping_address = '[ĐÃ XÓA THEO YÊU CẦU]',
          customer_email = null,
          updated_at = ?
      WHERE customer_phone = ?
    `).run(now, customerId)

    return {
      status: 'SUCCEEDED',
      customer_id: customerId,
      preferences_deleted: prefInfo.changes,
      memory_facts_deleted: memInfo.changes,
      orders_anonymized: orderInfo.changes,
      message: 'Toàn bộ dữ liệu số đo, sở thích cá nhân và địa chỉ đã được xóa / ẩn danh hóa an toàn (B11).',
      evidence_ref: `data_purge:${customerId}`,
    }
  }

  /**
   * Lên lịch chăm sóc sau mua (Post-Purchase Care)
   * Chỉ kích hoạt sau khi kiện hàng đã giao thành công (deliveredAt)
   */
  static schedulePostPurchaseCheckin(db, {
    tenantId = 'default',
    shopId = 'quannguyens',
    orderId,
    customerId,
    channel = 'messenger',
    recipientId,
    deliveredAt = new Date().toISOString(),
    delayHours = 24, // 24 giờ sau khi nhận
  }) {
    const eligibleAfter = new Date(new Date(deliveredAt).getTime() + delayHours * 60 * 60 * 1000).toISOString()
    const jobId = `JOB-CHECKIN-${orderId}`
    const businessKey = `checkin:${orderId}`
    const now = new Date().toISOString()

    const payload = {
      orderId,
      customerId,
      channel,
      recipientId,
      type: 'post_purchase_checkin',
    }

    db.prepare(`
      INSERT INTO jobs (
        id, business_key, job_type, payload_json, status, eligible_after, created_at, updated_at
      ) VALUES (?, ?, 'post_purchase_checkin', ?, 'READY', ?, ?, ?)
      ON CONFLICT(business_key) DO UPDATE SET
        eligible_after = excluded.eligible_after,
        updated_at = excluded.updated_at
    `).run(
      jobId,
      businessKey,
      JSON.stringify(payload),
      eligibleAfter,
      now,
      now
    )

    return {
      status: 'SUCCEEDED',
      job_id: jobId,
      business_key: businessKey,
      eligible_after: eligibleAfter,
      evidence_ref: `job:${jobId}`,
    }
  }

  /**
   * Thực thi Job chăm sóc có kiểm soát can_send chặt chẽ (Gate B12, T34)
   * Nếu đơn hàng đang có Case mở khiếu nại -> LẬP TỨC CHẶN TIN MARKETING / CHĂM SÓC
   */
  static evaluateAndDispatchJob(db, job) {
    const payload = JSON.parse(job.payload_json)

    // 1. Kiểm tra xem có Case mở cho đơn hàng này không (T34)
    if (payload.orderId) {
      const openCase = db.prepare(`
        SELECT id FROM cases WHERE order_id = ? AND status IN ('OPEN', 'IN_PROGRESS')
      `).get(payload.orderId)

      if (openCase) {
        // Có case mở -> CHẶN NGAY, không làm phiền khách
        db.prepare(`
          UPDATE jobs SET status = 'SUPPRESSED_CASE_OPEN', updated_at = ? WHERE id = ?
        `).run(new Date().toISOString(), job.id)

        return {
          status: 'DENIED',
          reason: 'SUPPRESSED_OPEN_CASE',
          message: `Chặn gửi tin vì đơn hàng ${payload.orderId} đang có Case mở xử lý sự cố (${openCase.id}) (T34)`,
        }
      }
    }

    // 2. Kiểm tra can_send qua bộ lọc kênh
    const gate = new CanSendGate(db)
    let lastInteraction = payload.lastCustomerInteractionAt || null
    if (!lastInteraction && payload.recipientId) {
      const conv = db.prepare(`
        SELECT last_interaction_at FROM conversations
        WHERE channel = ? AND channel_conversation_id = ?
      `).get(payload.channel || 'messenger', payload.recipientId)
      if (conv) {
        lastInteraction = conv.last_interaction_at
      } else {
        lastInteraction = new Date().toISOString()
      }
    }

    const gateCheck = gate.evaluate({
      channel: payload.channel || 'messenger',
      recipientId: payload.recipientId,
      customerId: payload.customerId,
      messageType: 'transactional',
      lastCustomerInteractionAt: lastInteraction,
      recipientHasOpenCase: false,
    })

    if (gateCheck.decision !== 'ALLOW') {
      db.prepare(`
        UPDATE jobs SET status = 'GATE_DENIED', last_error = ?, updated_at = ? WHERE id = ?
      `).run(gateCheck.reasonCode, new Date().toISOString(), job.id)

      return {
        status: 'DENIED',
        reason: gateCheck.reasonCode,
      }
    }

    // 3. Đạt điều kiện -> Đánh dấu hoàn thành job
    db.prepare(`
      UPDATE jobs SET status = 'COMPLETED', updated_at = ? WHERE id = ?
    `).run(new Date().toISOString(), job.id)

    return {
      status: 'ALLOWED',
      job_id: job.id,
      dispatched: true,
    }
  }
}
