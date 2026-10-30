import { BrowserManager } from './browserManager.js'
import { MetaBusinessSuiteAgent } from './metaBusinessSuiteAgent.js'
import { config } from '../config/env.js'
import { killSwitch } from '../config/killSwitch.js'
import fs from 'node:fs'
import path from 'node:path'

/**
 * AutoPilotService - Dịch vụ điều phối tự động hóa 24/7 chạy nền
 */
export class AutoPilotService {
  constructor(options = {}) {
    this.pollIntervalMs = options.pollIntervalMs || config.PLAYWRIGHT_POLL_INTERVAL_MS || 6000
    this.autoReply = options.autoReply !== undefined ? options.autoReply : config.PLAYWRIGHT_AUTO_REPLY
    this.maxRepliesPerHour = options.maxRepliesPerHour || 120
    this.stateFilePath = options.stateFilePath !== undefined ? options.stateFilePath : path.resolve(process.cwd(), 'data/autopilot_state.json')

    this.browserManager = new BrowserManager(options)
    this.metaAgent = new MetaBusinessSuiteAgent(options)

    this.state = 'STOPPED' // STOPPED | STARTING | RUNNING | PAUSED | ERROR
    this.timer = null
    this.isCycleRunning = false

    this.stats = {
      startTime: null,
      totalCycles: 0,
      totalRepliesSent: 0,
      lastCycleAt: null,
      lastRepliedAt: null,
      lastCustomerProcessed: null,
      consecutiveErrors: 0,
      lastError: null,
    }

    this.hourlyReplyTimestamps = []
  }

  /**
   * Lưu trạng thái tiến trình ra file để chia sẻ giữa Server API và Worker PM2
   */
  saveState() {
    if (!this.stateFilePath) return
    try {
      const stateData = {
        service: 'Playwright Meta Business Suite Auto-Pilot',
        state: this.state,
        autoReply: this.autoReply,
        pollIntervalMs: this.pollIntervalMs,
        browserReady: this.browserManager.isReady(),
        pid: process.pid,
        killSwitch: {
          globalStopped: killSwitch.isGlobalStopped(),
          playwrightBlocked: !killSwitch.isChannelAllowed('playwright'),
        },
        stats: { ...this.stats },
        rateLimit: {
          sentInLastHour: this.hourlyReplyTimestamps.length,
          maxPerHour: this.maxRepliesPerHour,
        },
        updatedAt: new Date().toISOString(),
      }
      fs.writeFileSync(this.stateFilePath, JSON.stringify(stateData, null, 2), 'utf8')
    } catch {}
  }

  /**
   * Kiểm tra giới hạn tốc độ (Rate Limit) gửi tin nhắn
   */
  canSendRateLimit() {
    const now = Date.now()
    const oneHourAgo = now - 3600000
    this.hourlyReplyTimestamps = this.hourlyReplyTimestamps.filter((t) => t > oneHourAgo)
    return this.hourlyReplyTimestamps.length < this.maxRepliesPerHour
  }

  recordReplySent() {
    this.hourlyReplyTimestamps.push(Date.now())
    this.stats.totalRepliesSent++
    this.stats.lastRepliedAt = new Date().toISOString()
  }

  /**
   * Khởi chạy vòng lặp tự động hóa
   */
  async start() {
    if (this.state === 'RUNNING' || this.state === 'STARTING') {
      console.log('ℹ️ [AUTOPILOT] Dịch vụ đã đang chạy hoặc đang khởi động.')
      return this.getStatus()
    }

    this.state = 'STARTING'
    console.log('🚀 [AUTOPILOT] Đang khởi động Playwright Auto-Pilot Service...')

    try {
      await this.browserManager.init()
      const page = await this.browserManager.getPage()
      await this.metaAgent.navigateToInbox(page)

      const loginCheck = await this.metaAgent.checkLoginStatus(page)
      if (loginCheck.isCheckpoint) {
        this.state = 'WAITING_FOR_VERIFICATION'
        console.error('\n🚨 ==============================================================================')
        console.error('🚨 [CẢNH BÁO BẢO MẬT META] PHÁT HIỆN YÊU CẦU XÁC MINH DANH TÍNH / CHECKPOINT!')
        console.error(`🚨 Đường dẫn hiện tại: ${loginCheck.currentUrl}`)
        console.error('🚨 AI ĐÃ TỰ ĐỘNG ĐÓNG BĂNG TOÀN BỘ THAO TÁC (KHÔNG CLICK / KHÔNG GỬI PHÍM).')
        console.error('👉 Vui lòng mở trình duyệt và hoàn tất xác minh danh tính tài khoản Meta.')
        console.error('🚨 Hệ thống đang ở chế độ chờ an toàn và sẽ TỰ ĐỘNG TIẾP TỤC ngay khi bạn xác minh xong.')
        console.error('==============================================================================\n')
      } else if (!loginCheck.isLoggedIn) {
        console.warn('⚠️ [AUTOPILOT CẢNH BÁO]:', loginCheck.reason)
        console.warn('👉 Hãy chạy "npm run playwright:login" để đăng nhập tài khoản trước.')
        this.state = 'RUNNING'
      } else {
        this.state = 'RUNNING'
      }

      this.stats.startTime = new Date().toISOString()
      this.stats.consecutiveErrors = 0
      this.saveState()

      // Bắt đầu vòng lặp thăm dò liên tục
      this.scheduleNextCycle(1000)
      console.log(`✅ [AUTOPILOT] Đã kích hoạt chạy nền liên tục (Tần suất quét: ${this.pollIntervalMs}ms).`)

      return this.getStatus()
    } catch (err) {
      this.state = 'ERROR'
      this.stats.lastError = err.message
      this.saveState()
      console.error('❌ [AUTOPILOT FATAL ERROR] Không thể khởi động AutoPilot:', err.message)
      throw err
    }
  }

  /**
   * Lên lịch cho chu kỳ tiếp theo (Duy trì liên tục cả khi đang đợi xác minh)
   */
  scheduleNextCycle(delayMs = null) {
    if (this.state !== 'RUNNING' && this.state !== 'WAITING_FOR_VERIFICATION') return

    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }

    // Khi đang chờ xác minh: thăm dò thụ động nhẹ nhàng mỗi 25 giây (không thao tác chuột/phím)
    if (this.state === 'WAITING_FOR_VERIFICATION') {
      this.timer = setTimeout(async () => {
        try {
          await this.runCycle()
        } catch (err) {
          console.warn('⚠️ [CHỜ XÁC MINH] Thăm dò trạng thái Meta:', err.message)
        } finally {
          if (this.state === 'WAITING_FOR_VERIFICATION' || this.state === 'RUNNING') {
            this.scheduleNextCycle()
          }
        }
      }, 25000)
      return
    }

    // Giả lập tần suất quét ngẫu nhiên tự nhiên của con người (+/- 1500ms)
    const baseDelay = delayMs !== null ? delayMs : this.pollIntervalMs
    const jitter = Math.floor(Math.random() * 3000) - 1500
    const delay = Math.max(4500, baseDelay + jitter)

    this.timer = setTimeout(async () => {
      try {
        await this.runCycle()
      } catch (err) {
        console.error('❌ [AUTOPILOT CYCLE ERROR]:', err.message)
      } finally {
        if (this.state === 'RUNNING' || this.state === 'WAITING_FOR_VERIFICATION') {
          this.scheduleNextCycle()
        }
      }
    }, delay)
  }

  /**
   * Thực thi một chu kỳ quét và trả lời tin nhắn
   */
  async runCycle(options = {}) {
    if (this.isCycleRunning) {
      return { skipped: true, reason: 'PREVIOUS_CYCLE_STILL_RUNNING' }
    }

    // Kiểm tra Kill Switch
    if (killSwitch.isGlobalStopped() || !killSwitch.isChannelAllowed('playwright')) {
      return { skipped: true, reason: 'KILL_SWITCH_ACTIVE' }
    }

    this.isCycleRunning = true
    this.stats.totalCycles++
    this.stats.lastCycleAt = new Date().toISOString()

    // Heartbeat log định kỳ mỗi 20 chu kỳ (~2 phút) để người vận hành an tâm
    if (this.stats.totalCycles === 1 || this.stats.totalCycles % 20 === 0) {
      console.log(
        `💓 [AUTOPILOT VẬN HÀNH 24/7] Chu kỳ #${this.stats.totalCycles} (${new Date().toLocaleTimeString('vi-VN')}): Đang tích cực giám sát Hộp thư Meta... Trạng thái: ${this.state}`
      )
    }

    try {
      const page = await this.browserManager.getPage()
      await this.metaAgent.navigateToInbox(page)

      const loginCheck = await this.metaAgent.checkLoginStatus(page)

      // ── PHÁT HIỆN YÊU CẦU XÁC MINH META (CHECKPOINT / 2FA) ────────────────
      if (loginCheck.isCheckpoint) {
        const wasWaiting = this.state === 'WAITING_FOR_VERIFICATION'
        this.state = 'WAITING_FOR_VERIFICATION'
        this.saveState()

        if (!wasWaiting) {
          console.error('\n🚨 ==============================================================================')
          console.error('🚨 [CẢNH BÁO BẢO MẬT META] PHÁT HIỆN YÊU CẦU XÁC MINH DANH TÍNH / CHECKPOINT!')
          console.error(`🚨 Đường dẫn hiện tại: ${loginCheck.currentUrl}`)
          console.error('🚨 AI ĐÃ TỰ ĐỘNG ĐÓNG BĂNG TOÀN BỘ THAO TÁC (KHÔNG CLICK / KHÔNG GỬI PHÍM).')
          console.error('👉 Vui lòng mở trình duyệt và hoàn tất xác minh danh tính tài khoản Meta.')
          console.error('🚨 Hệ thống đang ở chế độ chờ an toàn và sẽ TỰ ĐỘNG TIẾP TỤC ngay khi bạn xác minh xong.')
          console.error('==============================================================================\n')
        }
        return { skipped: true, reason: 'WAITING_FOR_HUMAN_VERIFICATION', details: loginCheck }
      }

      // Nếu trước đó đang chờ xác minh mà nay đã đăng nhập thành công
      if (this.state === 'WAITING_FOR_VERIFICATION' && loginCheck.isLoggedIn) {
        console.log('\n🎉 ==============================================================================')
        console.log('🎉 [XÁC MINH META THÀNH CÔNG] Đã nhận diện phiên đăng nhập hợp lệ trở lại!')
        console.log('🚀 AI Agent đã tự động mở băng và tiếp tục chăm sóc khách hàng 24/7 bình thường.')
        console.log('==============================================================================\n')
        this.state = 'RUNNING'
        this.stats.consecutiveErrors = 0
        this.saveState()
      }

      if (!loginCheck.isLoggedIn) {
        this.saveState()
        return { skipped: true, reason: 'NOT_LOGGED_IN', details: loginCheck }
      }

      // 1. Quét cuộc hội thoại đang mở hiện tại
      let processedCurrent = null
      if (this.canSendRateLimit()) {
        processedCurrent = await this.metaAgent.processCurrentConversation(page, {
          dryRun: !this.autoReply || options.dryRun,
        })

        if (processedCurrent && processedCurrent.success && !processedCurrent.dryRun) {
          this.recordReplySent()
          this.stats.lastCustomerProcessed = processedCurrent.customerName
        }
      } else {
        console.warn('⚠️ [AUTOPILOT RATE LIMIT] Đã đạt giới hạn tối đa số tin nhắn/giờ. Tạm dừng gửi.')
      }

      // 2. Quét danh sách các hội thoại chưa đọc khác ở thanh bên
      const conversationList = await this.metaAgent.scanConversationList(page)
      const unreadList = conversationList.filter((c) => c.isUnread)

      if (unreadList.length > 0 && this.canSendRateLimit()) {
        console.log(`📬 [AUTOPILOT] Tìm thấy ${unreadList.length} hội thoại chưa đọc. Đang chọn xử lý...`)
        // Bấm vào hội thoại chưa đọc đầu tiên
        await this.metaAgent.selectConversationByIndex(page, unreadList[0].index)
        await page.waitForTimeout(2000)

        const processedUnread = await this.metaAgent.processCurrentConversation(page, {
          dryRun: !this.autoReply || options.dryRun,
        })

        if (processedUnread && processedUnread.success && !processedUnread.dryRun) {
          this.recordReplySent()
          this.stats.lastCustomerProcessed = processedUnread.customerName
        }
      }

      this.stats.consecutiveErrors = 0
      this.saveState()
      return {
        success: true,
        processedCurrent,
        unreadCount: unreadList.length,
        timestamp: new Date().toISOString(),
      }
    } catch (err) {
      this.stats.consecutiveErrors++
      this.stats.lastError = err.message
      this.saveState()
      console.error(`⚠️ [AUTOPILOT LỖI CHU KỲ #${this.stats.totalCycles}]:`, err.message)

      // TỰ PHỤC HỒI LIÊN TỤC: Khi gặp lỗi ngữ cảnh/trình duyệt crash, tự động khởi động lại trình duyệt
      // Tuyệt đối không dừng tiến trình (không chuyển sang PAUSED)
      if (this.stats.consecutiveErrors >= 3) {
        console.warn('🔄 [AUTOPILOT SELF-HEALING] Tự động hồi phục và khởi tạo lại trình duyệt ngầm...')
        try {
          await this.browserManager.close().catch(() => {})
          await new Promise((r) => setTimeout(r, 4000))
          await this.browserManager.init().catch(() => {})
          this.stats.consecutiveErrors = 0
          console.log('✅ [AUTOPILOT SELF-HEALING] Đã tái khởi động trình duyệt thành công!')
        } catch (recoverErr) {
          console.error('❌ [AUTOPILOT SELF-HEALING] Lỗi tái khởi động:', recoverErr.message)
        }
      }

      return { success: false, error: err.message }
    } finally {
      this.isCycleRunning = false
    }
  }

  /**
   * Tạm dừng dịch vụ
   */
  pause() {
    this.state = 'PAUSED'
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.saveState()
    console.log('⏸️ [AUTOPILOT] Đã tạm dừng dịch vụ.')
    return this.getStatus()
  }

  /**
   * Dừng hẳn và đóng trình duyệt
   */
  async stop() {
    this.state = 'STOPPED'
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.saveState()
    await this.browserManager.close().catch(() => {})
    console.log('🛑 [AUTOPILOT] Đã dừng hoàn toàn dịch vụ và giải phóng trình duyệt.')
    return this.getStatus()
  }

  /**
   * Xem trạng thái sức khỏe và thông số vận hành (Đồng bộ thời gian thực giữa các tiến trình)
   */
  getStatus() {
    // Nếu tiến trình hiện tại là Web Server (state=STOPPED), đọc trạng thái thời gian thực từ Worker chạy ngầm
    if (this.stateFilePath && this.state === 'STOPPED' && fs.existsSync(this.stateFilePath)) {
      try {
        const fileContent = fs.readFileSync(this.stateFilePath, 'utf8')
        const fileState = JSON.parse(fileContent)
        const updatedMs = new Date(fileState.updatedAt).getTime()
        // Nếu file được Worker cập nhật trong vòng 30 giây gần nhất
        if (Date.now() - updatedMs < 30000) {
          return { ...fileState, isLiveWorker: true }
        }
      } catch {}
    }

    return {
      service: 'Playwright Meta Business Suite Auto-Pilot',
      state: this.state,
      autoReply: this.autoReply,
      pollIntervalMs: this.pollIntervalMs,
      browserReady: this.browserManager.isReady(),
      pid: process.pid,
      killSwitch: {
        globalStopped: killSwitch.isGlobalStopped(),
        playwrightBlocked: !killSwitch.isChannelAllowed('playwright'),
      },
      stats: { ...this.stats },
      rateLimit: {
        sentInLastHour: this.hourlyReplyTimestamps.length,
        maxPerHour: this.maxRepliesPerHour,
      },
    }
  }
}

// Singleton instance
export const autoPilotService = new AutoPilotService()
