import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { config } from '../config/env.js'
import { auditLogger } from './auditLogger.js'

/**
 * AlertNotifier - Hệ thống báo động khẩn cấp khi AI Agent gặp Checkpoint Meta,
 * mất phiên đăng nhập hoặc lỗi hệ thống nghiêm trọng cần chủ shop can thiệp.
 */
class AlertNotifier {
  constructor() {
    this.cooldownMs = 15 * 60 * 1000 // Chống spam cảnh báo: tối đa 1 lần / 15 phút cho mỗi mã sự cố
    this.lastSentByCode = new Map()
    this.alertStatePath = path.resolve(process.cwd(), 'data/critical_alert.json')
    this.activeAlert = null
  }

  /**
   * Ghi nhận và phát cảnh báo khẩn cấp đa kênh (Windows Popup, Telegram, Messenger Admin, Webhook, Audit DB)
   */
  async sendCriticalAlert({ code, title, message, details = {} }) {
    const now = Date.now()
    const lastSent = this.lastSentByCode.get(code) || 0

    this.activeAlert = {
      active: true,
      code,
      title,
      message,
      details,
      triggeredAt: new Date(now).toISOString(),
    }

    try {
      const dir = path.dirname(this.alertStatePath)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(this.alertStatePath, JSON.stringify(this.activeAlert, null, 2), 'utf8')
    } catch {}

    // Chống lặp thông báo liên tục mỗi chu kỳ 6 giây
    if (now - lastSent < this.cooldownMs) {
      return { sent: false, throttled: true, activeAlert: this.activeAlert }
    }
    this.lastSentByCode.set(code, now)

    const timestampVN = new Date(now).toLocaleString('vi-VN', { timeZone: config.TIMEZONE || 'Asia/Ho_Chi_Minh' })
    const fullText = `🚨 [CẢNH BÁO KHẨN CẤP - QUANNGUYENS CSKH]\n• Sự cố: ${title}\n• Mã: ${code}\n• Thời gian: ${timestampVN}\n• Chi tiết: ${message}`

    console.error(`\n${fullText}\n`)

    // 1. Ghi nhận vào Audit Log SQLite
    try {
      auditLogger.logAction({
        actorType: 'SYSTEM_WATCHDOG',
        actorId: 'autopilot_watchdog',
        actionName: 'CRITICAL_ALERT_TRIGGERED',
        targetEntityType: 'system',
        targetEntityId: code,
        inputPayload: { title, message, details },
        resultStatus: 'ALERTED',
      })
    } catch {}

    const deliveries = {}

    // 2. Cảnh báo trực tiếp qua Telegram Bot (về điện thoại chủ shop tức thì)
    if (config.ALERT_TELEGRAM_BOT_TOKEN && config.ALERT_TELEGRAM_CHAT_ID) {
      try {
        const tgUrl = `https://api.telegram.org/bot${config.ALERT_TELEGRAM_BOT_TOKEN}/sendMessage`
        const res = await fetch(tgUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: config.ALERT_TELEGRAM_CHAT_ID,
            text: fullText,
          }),
          signal: AbortSignal.timeout(8000),
        })
        deliveries.telegram = res.ok
      } catch (err) {
        deliveries.telegramError = err.message
      }
    }

    // 3. Cảnh báo qua Facebook Messenger tới tài khoản Quản trị viên App (hoạt động ngay cả ở Standard Access)
    if (config.ALERT_ADMIN_MESSENGER_PSID && config.META_PAGE_ACCESS_TOKEN) {
      try {
        const fbUrl = `https://graph.facebook.com/${config.META_GRAPH_VERSION || 'v21.0'}/me/messages`
        const res = await fetch(fbUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.META_PAGE_ACCESS_TOKEN}`,
          },
          body: JSON.stringify({
            recipient: { id: config.ALERT_ADMIN_MESSENGER_PSID },
            message: { text: fullText },
          }),
          signal: AbortSignal.timeout(8000),
        })
        deliveries.messengerAdmin = res.ok
      } catch (err) {
        deliveries.messengerAdminError = err.message
      }
    }

    // 4. Cảnh báo qua Webhook ngoài (Google Apps Script gửi Email tới quannguyentop1lux@gmail.com / Discord / Slack)
    if (config.ALERT_WEBHOOK_URL) {
      try {
        const res = await fetch(config.ALERT_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code,
            title,
            message,
            fullText,
            details,
            timestamp: timestampVN,
          }),
          signal: AbortSignal.timeout(8000),
        })
        deliveries.webhook = res.ok
      } catch (err) {
        deliveries.webhookError = err.message
      }
    }

    // 5. Hiển thị hộp thoại cảnh báo trên màn hình Windows (không chặn tiến trình ngầm)
    if (process.platform === 'win32' && config.ALERT_DESKTOP_POPUP !== false && !process.env.NODE_TEST_CONTEXT) {
      try {
        const safeTitle = title.replace(/["'`$]/g, '')
        const safeMsg = message.replace(/["'`$]/g, '').slice(0, 240)
        const psCmd = `$ws = New-Object -ComObject WScript.Shell; $null = $ws.Popup("${safeMsg}", 30, "CANH BAO KHAN QNS CSKH: ${safeTitle}", 48)`
        const child = spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', psCmd], {
          detached: true,
          stdio: 'ignore',
        })
        child.unref()
        deliveries.desktopPopup = true
      } catch {}
    }

    return { sent: true, deliveries, activeAlert: this.activeAlert }
  }

  /**
   * Xóa trạng thái cảnh báo khi hệ thống đã tự phục hồi hoặc chủ shop đã xác minh xong
   */
  clearAlert(code = null) {
    if (!this.activeAlert) return
    if (code && this.activeAlert.code !== code) return

    this.activeAlert = null
    if (code) {
      this.lastSentByCode.delete(code)
    }
    try {
      if (fs.existsSync(this.alertStatePath)) {
        fs.unlinkSync(this.alertStatePath)
      }
    } catch {}
  }

  getActiveAlert() {
    if (this.activeAlert) return this.activeAlert
    try {
      if (fs.existsSync(this.alertStatePath)) {
        return JSON.parse(fs.readFileSync(this.alertStatePath, 'utf8'))
      }
    } catch {}
    return null
  }
}

export const alertNotifier = new AlertNotifier()
