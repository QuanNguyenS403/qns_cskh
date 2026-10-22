import { getDb } from '../db/connection.js'
import { config } from '../config/env.js'
import { killSwitch } from '../config/killSwitch.js'

/**
 * CỔNG QUYẾT ĐỊNH GỬI TIN BẮT BUỘC (can_send Runtime Gate)
 * Blueprint §12.2, Prompt A B12
 * Kiểm tra ngay tại thời điểm gửi (ALLOW / DEFER / DENY + mã lý do)
 */

export const RETIRED_META_TAGS = [
  'CONFIRMED_EVENT_UPDATE',
  'ACCOUNT_UPDATE',
  'POST_PURCHASE_UPDATE',
]

export class CanSendGate {
  constructor(db = null) {
    this._db = db
  }

  get db() {
    return this._db || getDb()
  }

  /**
   * Kiểm tra thời gian hiện tại có rơi vào Giờ Nghỉ (Quiet Hours) hay không
   */
  isQuietHours(nowDate = new Date()) {
    const timeFormatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: config.TIMEZONE,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })

    const [hour, min] = timeFormatter.format(nowDate).split(':').map(Number)
    const currentMinutes = hour * 60 + min

    const [qStartHour, qStartMin] = config.QUIET_HOURS_START.split(':').map(Number)
    const [qEndHour, qEndMin] = config.QUIET_HOURS_END.split(':').map(Number)

    const qStartTotal = qStartHour * 60 + qStartMin
    const qEndTotal = qEndHour * 60 + qEndMin

    if (qStartTotal > qEndTotal) {
      // Qua đêm (ví dụ: 20:00 -> 09:00 sáng hôm sau)
      return currentMinutes >= qStartTotal || currentMinutes < qEndTotal
    } else {
      return currentMinutes >= qStartTotal && currentMinutes < qEndTotal
    }
  }

  /**
   * Đánh giá quyền gửi runtime
   */
  evaluate({
    tenantId = config.DEFAULT_TENANT_ID,
    shopId = config.DEFAULT_SHOP_ID,
    customerId,
    channel, // web | messenger | instagram | threads | zalo
    messageType, // transactional | support | marketing
    metaMessageTag = null,
    isHumanAgent = false,
    lastCustomerInteractionAt = null,
    now = new Date(),
  }) {
    const ch = channel.toLowerCase()

    // 1. Kiểm tra Kill Switch
    if (killSwitch.isGlobalStopped()) {
      return { decision: 'DENY', reasonCode: 'GLOBAL_KILL_SWITCH_ACTIVE', message: 'Hệ thống đang tạm dừng toàn cục' }
    }

    if (!killSwitch.isChannelAllowed(ch)) {
      return { decision: 'DENY', reasonCode: 'CHANNEL_DISABLED', message: `Kênh ${ch} đang bị tắt bởi Kill Switch` }
    }

    // 2. Chặn cứng các Tag Messenger đã ngừng (B12 requirement)
    if (metaMessageTag && RETIRED_META_TAGS.includes(metaMessageTag)) {
      return {
        decision: 'DENY',
        reasonCode: 'RETIRED_META_TAG_BLOCKED',
        message: `Tag ${metaMessageTag} đã bị Meta khai tử từ 27/04/2026, bị chặn cứng.`,
      }
    }

    // 3. Chặn bot tự nhận HUMAN_AGENT (B12 requirement)
    if (isHumanAgent) {
      return {
        decision: 'DENY',
        reasonCode: 'BOT_CANNOT_USE_HUMAN_AGENT',
        message: 'Bot tự động không được phép mượn quyền HUMAN_AGENT.',
      }
    }

    // 4. Kiểm tra Cửa sổ 24 giờ cho Messenger / Instagram (Standard 24h Window)
    if (ch === 'messenger' || ch === 'instagram') {
      if (messageType === 'marketing' || !metaMessageTag) {
        if (!lastCustomerInteractionAt) {
          return {
            decision: 'DENY',
            reasonCode: 'OUTSIDE_24H_WINDOW',
            message: `Không có mốc tương tác khách hàng để gửi tin nhắn trong cửa sổ 24h của ${channel}.`,
          }
        }

        const elapsedMs = now.getTime() - new Date(lastCustomerInteractionAt).getTime()
        const twentyFourHoursMs = 24 * 60 * 60 * 1000

        if (elapsedMs > twentyFourHoursMs) {
          return {
            decision: 'DENY',
            reasonCode: 'OUTSIDE_24H_WINDOW',
            message: `Đã quá 24 giờ kể từ lần tương tác cuối của khách (${Math.round(elapsedMs / 3600000)}h trôi qua).`,
          }
        }
      }
    }

    // 5. Kiểm tra Hồ sơ khiếu nại đang mở (Suppression Rule - B12)
    // Nếu khách đang có Case chưa đóng (OPEN / INVESTIGATING / WAITING) -> Chặn toàn bộ tin tiếp thị
    if (customerId && messageType === 'marketing') {
      const openCase = this.db.prepare(`
        SELECT id, issue_type, priority FROM cases
        WHERE customer_id = ? AND status NOT IN ('RESOLVED', 'CLOSED')
        LIMIT 1
      `).get(customerId)

      if (openCase) {
        return {
          decision: 'DENY',
          reasonCode: 'SUPPRESSED_DUE_TO_OPEN_CASE',
          message: `Khách hàng đang có Case hỗ trợ mở (#${openCase.id} - ${openCase.issue_type}). Chặn tiếp thị!`,
        }
      }
    }

    // 6. Kiểm tra Quyền Consent / Lựa chọn Opt-Out của khách
    if (customerId && messageType === 'marketing') {
      const consent = this.db.prepare(`
        SELECT status FROM consents
        WHERE customer_id = ? AND purpose = 'marketing' AND (channel = ? OR channel = 'all')
        ORDER BY recorded_at DESC LIMIT 1
      `).get(customerId, ch)

      if (consent && consent.status === 'REVOKED') {
        return {
          decision: 'DENY',
          reasonCode: 'CUSTOMER_OPTED_OUT',
          message: 'Khách hàng đã từ chối nhận tin tiếp thị trên kênh này hoặc trên toàn bộ các kênh.',
        }
      }
    }

    // 7. Kiểm tra Giờ nghỉ (Quiet Hours: 20:00 -> 09:00 sáng hôm sau)
    if (messageType === 'marketing' && this.isQuietHours(now)) {
      return {
        decision: 'DEFER',
        reasonCode: 'QUIET_HOURS',
        message: 'Đang trong khung giờ nghỉ ban đêm (20:00 - 09:00). Dời lịch gửi sang sáng hôm sau.',
      }
    }

    // 8. Kiểm tra Trần tần suất tiếp thị (H12: Kiểm tra cả trần 7 ngày và 30 ngày)
    if (customerId && messageType === 'marketing') {
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
      const sentLast7d = this.db.prepare(`
        SELECT COUNT(*) as count FROM outbox
        WHERE recipient_id = ? AND message_type = 'marketing' AND status = 'SENT' AND updated_at >= ?
      `).get(customerId, sevenDaysAgo).count

      if (sentLast7d >= config.MARKETING_MAX_7D) {
        return {
          decision: 'DENY',
          reasonCode: 'FREQUENCY_CAP_EXCEEDED_7D',
          message: `Vượt quá giới hạn tần suất tiếp thị 7 ngày (Đã gửi ${sentLast7d} tin trong 7 ngày).`,
        }
      }

      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
      const sentLast30d = this.db.prepare(`
        SELECT COUNT(*) as count FROM outbox
        WHERE recipient_id = ? AND message_type = 'marketing' AND status = 'SENT' AND updated_at >= ?
      `).get(customerId, thirtyDaysAgo).count

      if (sentLast30d >= config.MARKETING_MAX_30D) {
        return {
          decision: 'DENY',
          reasonCode: 'FREQUENCY_CAP_EXCEEDED_30D',
          message: `Vượt quá giới hạn tần suất tiếp thị 30 ngày (Đã gửi ${sentLast30d} tin trong 30 ngày).`,
        }
      }
    }

    return {
      decision: 'ALLOW',
      reasonCode: 'PASSED_ALL_CHECKS',
      message: 'Đủ điều kiện gửi tin.',
    }
  }
}

export const canSendGate = new CanSendGate()
