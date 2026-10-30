import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { config } from '../config/env.js'

/**
 * BrowserManager - Quản lý vòng đời trình duyệt Playwright Chromium
 * Hỗ trợ persistent context (lưu cookie, session, 2FA tự động vào data/playwright_profile)
 * Tích hợp cơ chế Stealth chống bị Meta gắn cờ tự động hóa.
 */
export class BrowserManager {
  constructor(options = {}) {
    this.headless = options.headless !== undefined ? options.headless : config.PLAYWRIGHT_HEADLESS
    this.userDataDir = options.userDataDir || config.PLAYWRIGHT_USER_DATA_DIR
    this.storageStatePath = options.storageStatePath || config.PLAYWRIGHT_STORAGE_STATE_PATH
    this.context = null
    this.page = null
    this.isInitialized = false
  }

  /**
   * Khởi tạo trình duyệt với profile bền vững (Persistent Context)
   */
  async init() {
    if (this.isInitialized && this.context) {
      return { context: this.context, page: this.page }
    }

    // Đảm bảo thư mục lưu trữ profile tồn tại
    if (!fs.existsSync(this.userDataDir)) {
      fs.mkdirSync(this.userDataDir, { recursive: true })
    }

    const storageDir = path.dirname(this.storageStatePath)
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true })
    }

    const launchArgs = [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-infobars',
      '--window-size=1366,768',
      '--disable-notifications',
      '--disable-gpu',
      '--lang=vi-VN,vi,en-US,en',
    ]

    const contextOptions = {
      headless: this.headless,
      viewport: { width: 1366, height: 768 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      locale: 'vi-VN',
      timezoneId: config.TIMEZONE || 'Asia/Ho_Chi_Minh',
      permissions: ['clipboard-read', 'clipboard-write'],
      args: launchArgs,
      ignoreDefaultArgs: ['--enable-automation'],
    }

    // Nếu có file storage_state JSON thì nạp
    if (fs.existsSync(this.storageStatePath)) {
      try {
        contextOptions.storageState = this.storageStatePath
      } catch (err) {
        console.warn('⚠️ [PLAYWRIGHT] Không thể nạp storageState, sẽ dùng Profile thư mục:', err.message)
      }
    }

    try {
      this.context = await chromium.launchPersistentContext(this.userDataDir, contextOptions)

      // Stealth evasions: Che giấu navigator.webdriver
      await this.context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', {
          get: () => undefined,
        })
        window.chrome = {
          runtime: {},
          loadTimes: function () {},
          csi: function () {},
          app: {},
        }
      })

      const pages = this.context.pages()
      this.page = pages.length > 0 ? pages[0] : await this.context.newPage()

      // Tối ưu hóa timeout mặc định
      this.page.setDefaultTimeout(30000)
      this.page.setDefaultNavigationTimeout(45000)

      this.isInitialized = true
      return { context: this.context, page: this.page }
    } catch (err) {
      console.error('❌ [PLAYWRIGHT BROWSER] Khởi động trình duyệt thất bại:', err.message)
      throw err
    }
  }

  /**
   * Lấy trang hiện tại hoặc tạo mới (Tự động phục hồi khi context/page bị crash hoặc closed)
   */
  async getPage() {
    if (!this.isInitialized || !this.context) {
      await this.init()
    }

    try {
      if (!this.page || this.page.isClosed()) {
        const openPages = this.context ? this.context.pages().filter((p) => !p.isClosed()) : []
        if (openPages.length > 0) {
          this.page = openPages[0]
        } else if (this.context) {
          this.page = await this.context.newPage()
        }
      }

      // Kiểm tra tính phản hồi thực tế của trang
      if (this.page && !this.page.isClosed()) {
        await this.page.evaluate(() => true)
      } else {
        throw new Error('Trang không phản hồi hoặc đã bị đóng')
      }
    } catch (err) {
      console.warn('🔄 [PLAYWRIGHT BROWSER] Ngữ cảnh trình duyệt bị ngắt kết nối hoặc crash, đang tự động khởi động lại...', err.message)
      await this.close().catch(() => {})
      await this.init()
      const openPages = this.context.pages().filter((p) => !p.isClosed())
      this.page = openPages.length > 0 ? openPages[0] : await this.context.newPage()
      this.page.setDefaultTimeout(30000)
      this.page.setDefaultNavigationTimeout(45000)
    }

    return this.page
  }

  /**
   * Lưu phiên đăng nhập (Cookies, LocalStorage) vào file JSON dự phòng
   */
  async saveStorageState(destPath = null) {
    if (!this.context) return null
    const targetPath = destPath || this.storageStatePath
    const dir = path.dirname(targetPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    await this.context.storageState({ path: targetPath })
    return targetPath
  }

  /**
   * Đóng trình duyệt an toàn
   */
  async close() {
    try {
      if (this.context) {
        await this.saveStorageState().catch(() => {})
        await this.context.close()
      }
    } finally {
      this.context = null
      this.page = null
      this.isInitialized = false
    }
  }

  /**
   * Kiểm tra xem trình duyệt có đang mở không
   */
  isReady() {
    return this.isInitialized && this.context !== null && this.page !== null && !this.page.isClosed()
  }
}
