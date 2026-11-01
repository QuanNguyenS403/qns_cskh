import { MayOrchestrator } from '../agent/mayOrchestrator.js'
import { getDb } from '../db/connection.js'
import { killSwitch } from '../config/killSwitch.js'

/**
 * MetaBusinessSuiteAgent - RPA Bot tự động hóa thao tác trên Meta Business Suite Inbox & Instagram Direct
 */
export class MetaBusinessSuiteAgent {
  constructor(options = {}) {
    this.inboxUrl = options.inboxUrl || 'https://business.facebook.com/latest/inbox/all'
    this.typingDelayMs = options.typingDelayMs || 35
    this.db = options.db || null
    this.orchestrator = options.orchestrator || null
    this.repliedCache = new Map() // Cache chống gửi trùng lặp tuyệt đối
  }

  getOrchestrator() {
    if (!this.orchestrator) {
      const db = this.db || getDb()
      this.orchestrator = new MayOrchestrator(db)
    }
    return this.orchestrator
  }

  /**
   * Kiểm tra chữ ký đặc trưng của Shop để phân biệt tin nhắn gửi đi vs tin nhắn nhận về
   */
  isShopSignature(text) {
    if (!text) return false
    const lower = text.toLowerCase()
    return (
      lower.startsWith('dạ quannguyens') ||
      lower.startsWith('dạ qns') ||
      lower.startsWith('quannguyens xin chào') ||
      lower.startsWith('mình là trợ lý ai') ||
      lower.includes('hệ thống ai cskh vừa được cập nhật') ||
      lower.includes('the classic set') ||
      lower.includes('the café look') ||
      lower.includes('the evening edit') ||
      lower.includes('tư vấn size theo chiều cao cân nặng') ||
      lower.includes('chào bạn! mình là trợ lý')
    )
  }

  /**
   * Điều hướng đến trang hộp thư Meta Business Suite
   */
  async navigateToInbox(page, targetUrl = null) {
    const url = targetUrl || this.inboxUrl
    const currentUrl = page.url()
    if (!currentUrl.includes('/latest/inbox')) {
      console.log(`🌐 [PLAYWRIGHT] Đang điều hướng đến Hộp thư Meta: ${url}`)
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
      await page
        .locator('div[role="textbox"][contenteditable="true"], div[contenteditable="true"]')
        .first()
        .waitFor({ state: 'visible', timeout: 15000 })
        .catch(() => {})
      await page.waitForTimeout(2500)
    }
  }

  /**
   * Kiểm tra trạng thái đăng nhập tài khoản Meta & phát hiện màn hình xác minh/checkpoint
   */
  async checkLoginStatus(page) {
    const url = page.url()
    const lowerUrl = url.toLowerCase()

    // 1. Nhận diện các dấu hiệu Checkpoint / Xác minh bảo mật 2FA của Meta
    const isCheckpointUrl =
      lowerUrl.includes('/checkpoint') ||
      lowerUrl.includes('/challenge') ||
      lowerUrl.includes('two_step_verification') ||
      lowerUrl.includes('two_factor') ||
      lowerUrl.includes('identity')

    if (isCheckpointUrl) {
      return {
        isLoggedIn: false,
        isCheckpoint: true,
        reason: 'Phát hiện trang yêu cầu xác minh bảo mật (Checkpoint / 2FA) từ Meta.',
        currentUrl: url,
      }
    }

    if (lowerUrl.includes('/login') || lowerUrl.includes('facebook.com/login')) {
      return {
        isLoggedIn: false,
        isCheckpoint: false,
        reason: 'Chưa đăng nhập Meta hoặc phiên đăng nhập đã hết hạn.',
        currentUrl: url,
      }
    }

    // Kiểm tra sự xuất hiện của các phần tử đặc trưng hộp thư hoặc chữ thông báo xác minh
    try {
      const pageAnalysis = await page.evaluate(() => {
        const text = document.body ? document.body.innerText || '' : ''
        const hasCheckpointText =
          /xác nhận danh tính|xác minh tài khoản|confirm your identity|suspicious activity|chúng tôi đã phát hiện hoạt động bất thường|nhập mã phê duyệt/i.test(
            text
          )

        const hasMain = Boolean(document.querySelector('div[role="main"]'))
        const hasEditor = Boolean(document.querySelector('div[contenteditable="true"]'))
        const hasNavigation = Boolean(document.querySelector('div[role="navigation"]'))

        return {
          hasCheckpointText,
          hasInboxElements: hasMain || hasEditor || hasNavigation,
        }
      })

      if (pageAnalysis.hasCheckpointText) {
        return {
          isLoggedIn: false,
          isCheckpoint: true,
          reason: 'Phát hiện văn bản yêu cầu xác nhận danh tính trên trang Meta.',
          currentUrl: url,
        }
      }

      return {
        isLoggedIn: pageAnalysis.hasInboxElements,
        isCheckpoint: false,
        reason: pageAnalysis.hasInboxElements
          ? 'Đã đăng nhập thành công vào Meta Inbox'
          : 'Đang tải giao diện hoặc chưa nạp xong.',
        currentUrl: url,
      }
    } catch (err) {
      return { isLoggedIn: false, isCheckpoint: false, reason: err.message, currentUrl: url }
    }
  }

  /**
   * Quét và trích xuất thông tin cuộc hội thoại đang được chọn trong viewport
   */
  async extractActiveConversation(page) {
    return await page.evaluate((signatures) => {
      // 1. Tìm tên khách hàng
      const nameSelectors = [
        'div[role="main"] h1',
        'div[role="main"] h2',
        'div[role="main"] header h1',
        'div[role="main"] header h2',
        'div[role="banner"] h1',
        'span[dir="auto"].x193iq5w',
        'h2[dir="auto"]',
        'h1[dir="auto"]',
      ]

      let customerName = 'Khách hàng'
      for (const sel of nameSelectors) {
        const els = document.querySelectorAll(sel)
        for (const el of els) {
          const text = el.innerText?.trim()
          if (
            text &&
            text.length > 1 &&
            text.length < 40 &&
            !/hộp thư|inbox|tìm kiếm|messenger|instagram|tất cả/i.test(text)
          ) {
            customerName = text
            break
          }
        }
        if (customerName !== 'Khách hàng') break
      }

      // Fallback cho giao diện Meta Business Suite 2026 (Tên khách hiển thị bằng div/span in đậm ở thanh tiêu đề khung chat)
      if (customerName === 'Khách hàng') {
        const headerCandidates = document.querySelectorAll('div, span, a')
        for (const el of headerCandidates) {
          if (el.children.length > 0) continue
          const rect = el.getBoundingClientRect()
          if (rect.left >= 520 && rect.left <= 920 && rect.top >= 115 && rect.top <= 195) {
            const style = window.getComputedStyle(el)
            const fw = parseInt(style.fontWeight, 10) || 400
            const fs = parseFloat(style.fontSize) || 14
            const text = el.innerText?.trim()
            if (
              fw >= 600 &&
              fs >= 15 &&
              text &&
              text.length > 1 &&
              text.length < 45 &&
              !/hộp thư|inbox|tìm kiếm|messenger|instagram|whatsapp|tất cả|quản lý|mới|bình luận/i.test(text)
            ) {
              customerName = text
              break
            }
          }
        }
      }

      // 2. Nhận diện nền tảng (Facebook Messenger vs Instagram Direct)
      const rightPanelText = Array.from(document.querySelectorAll('div, span, a'))
        .filter((el) => {
          const r = el.getBoundingClientRect()
          return (r.left > 940 && r.top > 115) || (r.left > 520 && r.top > 115 && r.top < 205)
        })
        .map((el) => `${el.getAttribute('aria-label') || ''} ${el.children.length === 0 ? el.innerText || '' : ''}`)
        .join(' ')
      const isInstagram =
        window.location.href.includes('instagram') ||
        /instagram/i.test(rightPanelText) ||
        Boolean(document.querySelector('div[role="main"] svg[aria-label*="Instagram"]')) ||
        Boolean(document.querySelector('div[role="main"] img[alt*="Instagram"]'))
      const channel = isInstagram ? 'instagram' : 'messenger'

      // 3. Tìm ô nhập liệu để xác định vùng trung tâm chat
      const editorSelectors = [
        'div[role="textbox"][contenteditable="true"]',
        'div[contenteditable="true"][aria-label*="nhắn"]',
        'div[contenteditable="true"][aria-label*="Nhắn"]',
        'div[contenteditable="true"][aria-label*="Message"]',
        'div[contenteditable="true"][aria-label*="message"]',
        'div[contenteditable="true"][data-lexical-editor="true"]',
        'div[contenteditable="true"]',
      ]

      let editorEl = null
      for (const sel of editorSelectors) {
        const el = document.querySelector(sel)
        if (el && el.offsetParent !== null) {
          editorEl = el
          break
        }
      }

      const mainContainer = editorEl ? editorEl.closest('div[role="main"]') || document.body : document.body
      const bounds = mainContainer.getBoundingClientRect()
      const midX = bounds.left + bounds.width / 2

      // 4. Quét các bong bóng tin nhắn
      const messageBlocks = document.querySelectorAll('div[dir="auto"]')
      const rawMessages = []

      for (const block of messageBlocks) {
        const text = block.innerText?.trim()
        if (!text || text.length < 2 || text.length > 800) continue
        if (/^(hôm nay|thứ|tin nhắn|đã xem|trả lời|quản lý|chưa đọc|ưu tiên|\d{1,2}:\d{2})/i.test(text)) continue
        if (text === customerName) continue

        const rect = block.getBoundingClientRect()
        // Nằm trong khung hiển thị tin nhắn (loại bỏ header và footer)
        if (rect.top > 70 && rect.bottom < window.innerHeight - 70) {
          const bubbleMidX = rect.left + rect.width / 2
          const isAlignedRight = bubbleMidX > midX - 25

          // Kiểm tra chữ ký Shop
          const lower = text.toLowerCase()
          const matchedSignature = signatures.some((sig) => lower.includes(sig))
          const isFromShop = matchedSignature || isAlignedRight

          rawMessages.push({
            text,
            isFromShop,
            isFromCustomer: !isFromShop,
            bottom: rect.bottom,
          })
        }
      }

      if (rawMessages.length === 0) {
        return {
          customerName,
          channel,
          hasMessages: false,
          needsReply: false,
          latestCustomerText: null,
          history: [],
        }
      }

      // Sắp xếp tin nhắn từ trên xuống dưới
      rawMessages.sort((a, b) => a.bottom - b.bottom)
      const lastMessage = rawMessages[rawMessages.length - 1]

      // Trích xuất 5 tin nhắn gần nhất làm ngữ cảnh
      const history = rawMessages.slice(-5).map((m) => ({
        role: m.isFromCustomer ? 'user' : 'model',
        text: m.text,
      }))

      // Nếu tin nhắn cuối cùng là của Shop -> Shop đã trả lời rồi, đang chờ khách
      if (lastMessage.isFromShop) {
        return {
          customerName,
          channel,
          hasMessages: true,
          needsReply: false,
          reason: 'Shop đã trả lời gần nhất, đang chờ khách phản hồi.',
          latestCustomerText: null,
          history,
        }
      }

      // Tin nhắn cuối là của khách -> Gom các tin nhắn liên tiếp của khách ở cuối
      const pendingCustomerTexts = []
      for (let i = rawMessages.length - 1; i >= 0; i--) {
        if (rawMessages[i].isFromCustomer) {
          pendingCustomerTexts.unshift(rawMessages[i].text)
        } else {
          break
        }
      }

      const combinedCustomerText = pendingCustomerTexts.join('. ')

      return {
        customerName,
        channel,
        hasMessages: true,
        needsReply: true,
        latestCustomerText: combinedCustomerText,
        history,
      }
    }, [
      'dạ quannguyens',
      'dạ qns',
      'quannguyens xin chào',
      'mình là trợ lý ai',
      'the classic set',
      'the café look',
      'the evening edit',
      'tư vấn size theo chiều cao cân nặng',
    ])
  }

  /**
   * Quét danh sách các hội thoại chưa đọc hoặc đang chờ trả lời ở thanh bên trái
   */
  async scanConversationList(page) {
    return await page.evaluate(() => {
      // Xóa đánh dấu cũ trước khi quét mới
      document.querySelectorAll('[data-qns-conv-idx]').forEach((el) => el.removeAttribute('data-qns-conv-idx'))

      // 1. Ưu tiên nhận diện thẻ hội thoại cột bên trái của Meta Business Suite (bền vững khi Meta đổi tên class CSS)
      let candidateRows = []
      const presentationDivs = Array.from(document.querySelectorAll('div[role="presentation"], div[role="row"], div[role="listitem"]'))
      const seenTopBuckets = new Set()

      for (const el of presentationDivs) {
        const r = el.getBoundingClientRect()
        if (r.left >= 30 && r.left <= 220 && r.width >= 250 && r.width <= 520 && r.height >= 55 && r.height <= 125 && r.top >= 165) {
          const rawText = (el.innerText || '').trim()
          if (!rawText || rawText.length < 3) continue
          if (/^tìm kiếm\b/i.test(rawText)) continue
          const bucket = Math.round(r.top / 25)
          if (!seenTopBuckets.has(bucket)) {
            seenTopBuckets.add(bucket)
            candidateRows.push(el)
          }
        }
      }

      // 2. Fallback nếu giao diện khác layout chuẩn
      if (candidateRows.length === 0) {
        const fallbackSelectors = [
          'div[data-testid="inbox-conversation-list-row"]',
          'div[role="navigation"] div[role="row"]',
          'div[role="list"] div[role="listitem"]',
          'div[role="navigation"] a[href*="/latest/inbox"]',
        ]
        for (const sel of fallbackSelectors) {
          const found = Array.from(document.querySelectorAll(sel))
          if (found.length > 0) {
            candidateRows = found
            break
          }
        }
      }

      const items = []
      candidateRows.forEach((row) => {
        const rawText = row.innerText?.trim() || ''
        if (rawText.length <= 2) return

        const idx = items.length
        row.setAttribute('data-qns-conv-idx', String(idx))

        const lines = rawText
          .split(/\n+/)
          .map((l) => l.trim())
          .filter(Boolean)
        const customerName = lines[0] || `Khách #${idx + 1}`
        const previewLine = lines[1] || ''

        const hasUnreadBadge =
          Boolean(row.querySelector('[aria-label*="chưa đọc" i]')) ||
          Boolean(row.querySelector('[aria-label*="Unread" i]')) ||
          Boolean(row.querySelector('span[data-visualcompletion="ignore-dynamic-layout"]')) ||
          /\bchưa đọc\b|\bunread\b/i.test(rawText)

        // Kiểm tra tin nhắn preview in đậm (chưa đọc trên Meta Business Suite)
        let hasBoldPreview = false
        const spans = row.querySelectorAll('span, div')
        for (const s of spans) {
          if (s.children.length > 0) continue
          const sText = s.innerText?.trim() || ''
          if (!sText || sText === customerName) continue
          const fw = parseInt(window.getComputedStyle(s).fontWeight, 10) || 400
          if (fw >= 600 && sText.length > 1 && !/^\d{1,2}\s*tháng|^\d{1,2}:\d{2}/i.test(sText)) {
            hasBoldPreview = true
            break
          }
        }

        // Kiểm tra khách nhắn cuối (dòng preview không bắt đầu bằng "Bạn:" / "You:")
        const isShopLast =
          /^bạn\s*:|^you\s*:|^dạ quannguyens|^dạ qns|^quannguyens xin chào/i.test(previewLine)
        const awaitingReply = Boolean(previewLine) && !isShopLast

        items.push({
          index: idx,
          selector: `[data-qns-conv-idx="${idx}"]`,
          customerName,
          previewLine: previewLine.slice(0, 120),
          snippet: lines.join(' | ').slice(0, 140),
          isUnread: hasUnreadBadge || hasBoldPreview,
          awaitingReply,
        })
      })

      return items
    })
  }

  /**
   * Chọn một cuộc hội thoại theo chỉ mục ở thanh danh sách
   */
  async selectConversationByIndex(page, index, preferredSelector = null) {
    const taggedLocator = page.locator(`[data-qns-conv-idx="${index}"]`).first()
    if ((await taggedLocator.count()) > 0) {
      await taggedLocator.scrollIntoViewIfNeeded().catch(() => {})
      await taggedLocator.click()
      await page.waitForTimeout(1800)
      return true
    }

    const selectorsToTry = preferredSelector
      ? [preferredSelector]
      : [
          'div[data-testid="inbox-conversation-list-row"]',
          'div[role="navigation"] div[role="row"], div[role="list"] div[role="listitem"], div[role="navigation"] a[href*="/latest/inbox"]',
        ]

    for (const selector of selectorsToTry) {
      const rows = page.locator(selector)
      const count = await rows.count()
      if (count > 0 && index < count) {
        await rows.nth(index).scrollIntoViewIfNeeded().catch(() => {})
        await rows.nth(index).click()
        await page.waitForTimeout(1800)
        return true
      }
    }
    return false
  }

  /**
   * Điền nội dung văn bản vào ô nhập tin nhắn và gửi
   */
  async sendReply(page, replyText) {
    if (!replyText || !replyText.trim()) {
      throw new Error('Nội dung trả lời không được để trống')
    }

    // 1. Tìm ô soạn thảo tin nhắn
    const editorSelectors = [
      'div[role="textbox"][contenteditable="true"]',
      'div[contenteditable="true"][aria-label*="nhắn"]',
      'div[contenteditable="true"][aria-label*="Nhắn"]',
      'div[contenteditable="true"][aria-label*="Message"]',
      'div[contenteditable="true"][aria-label*="message"]',
      'div[contenteditable="true"][data-lexical-editor="true"]',
      'div[contenteditable="true"]',
    ]

    let editorLocator = null
    for (const sel of editorSelectors) {
      const loc = page.locator(sel).first()
      if (await loc.isVisible().catch(() => false)) {
        editorLocator = loc
        break
      }
    }

    if (!editorLocator) {
      throw new Error('Không tìm thấy ô nhập tin nhắn trong giao diện Meta Inbox')
    }

    // 2. Focus vào editor
    await editorLocator.focus()
    await page.waitForTimeout(200)

    // 3. Điền văn bản an toàn mô phỏng người dùng gõ
    // Dùng clipboard paste hoặc fill/type để xử lý tiếng Việt có dấu chuẩn xác
    await page.evaluate((text) => {
      const activeEl = document.activeElement
      if (activeEl && activeEl.isContentEditable) {
        document.execCommand('selectAll', false, null)
        const success = document.execCommand('insertText', false, text)
        if (!success) {
          activeEl.innerText = text
        }
        activeEl.dispatchEvent(new Event('input', { bubbles: true }))
        activeEl.dispatchEvent(new Event('change', { bubbles: true }))
      }
    }, replyText)

    await page.waitForTimeout(400)

    // 4. Nhấn Enter để gửi
    await page.keyboard.press('Enter')
    await page.waitForTimeout(1200)

    // 5. Kiểm tra nút Send (nếu có trường hợp Enter chỉ xuống dòng)
    const sendBtn = page.locator('div[aria-label="Gửi"], div[aria-label="Send"], button[aria-label="Gửi"]').first()
    if (await sendBtn.isVisible().catch(() => false)) {
      await sendBtn.click().catch(() => {})
      await page.waitForTimeout(1000)
    }

    console.log(`🚀 [PLAYWRIGHT] Đã gửi thành công tin nhắn đến khách hàng.`)
    return { success: true, text: replyText }
  }

  /**
   * Xử lý trọn gói 1 lượt: Đọc tin nhắn -> Gọi AI Orchestrator -> Kiểm duyệt -> Gửi trả lời
   */
  async processCurrentConversation(page, options = {}) {
    const { dryRun = false } = options

    // Kiểm tra Kill Switch
    if (killSwitch.isGlobalStopped() || !killSwitch.isChannelAllowed('playwright')) {
      console.warn('⚠️ [PLAYWRIGHT] Kill switch đang BẬT hoặc kênh Playwright bị khóa. Bỏ qua gửi tin.')
      return { skipped: true, reason: 'KILL_SWITCH_ACTIVE' }
    }

    const conversationData = await this.extractActiveConversation(page)
    if (!conversationData.hasMessages) {
      return { skipped: true, reason: 'NO_MESSAGES_FOUND' }
    }

    if (!conversationData.needsReply) {
      return { skipped: true, reason: conversationData.reason }
    }

    const customerText = conversationData.latestCustomerText
    const customerName = conversationData.customerName
    const channel = conversationData.channel

    // Kiểm tra cache chống gửi trùng lặp (nếu vừa trả lời khách này trong vòng 90 giây)
    const replyCacheKey = `${customerName}_${customerText.trim()}`
    const lastRepliedTime = this.repliedCache.get(replyCacheKey)
    if (lastRepliedTime && Date.now() - lastRepliedTime < 90000) {
      return { skipped: true, reason: 'ALREADY_REPLIED_RECENTLY' }
    }

    console.log(`📩 [PLAYWRIGHT] Phát hiện tin nhắn mới từ khách "${customerName}" (${channel}): "${customerText}"`)

    // Giả lập thời gian con người đọc tin nhắn trước khi bắt đầu gõ (1.5s - 2.5s)
    const readingDelay = Math.floor(Math.random() * 1000) + 1500
    await page.waitForTimeout(readingDelay)

    // Gọi Bộ não AI QNS (MayOrchestrator)
    const orchestrator = this.getOrchestrator()
    const agentResponse = await orchestrator.processMessage({
      text: customerText,
      channel,
      senderId: `playwright_${customerName.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}`,
      conversationState: {
        customerName,
        history: conversationData.history || [],
      },
      isCopilot: false,
    })

    const replyText = agentResponse.customer_message

    if (!replyText) {
      console.warn('⚠️ [PLAYWRIGHT] AI Orchestrator không sinh ra câu trả lời cho tin nhắn này.')
      return { skipped: true, reason: 'NO_AI_REPLY_GENERATED', agentResponse }
    }

    console.log(`💡 [PLAYWRIGHT AI QNS]: "${replyText.slice(0, 80)}..."`)

    if (dryRun) {
      console.log('🧪 [PLAYWRIGHT DRY RUN] Chế độ kiểm thử: Không gửi tin nhắn thực tế.')
      return {
        success: true,
        dryRun: true,
        customerName,
        customerText,
        replyText,
        agentResponse,
      }
    }

    // Gửi tin nhắn thực tế lên Meta
    const sendResult = await this.sendReply(page, replyText)

    // Ghi nhận vào cache chống gửi trùng lặp
    this.repliedCache.set(replyCacheKey, Date.now())
    if (this.repliedCache.size > 500) {
      const oldestKey = this.repliedCache.keys().next().value
      this.repliedCache.delete(oldestKey)
    }

    return {
      success: true,
      customerName,
      customerText,
      replyText,
      sendResult,
      agentResponse,
    }
  }
}
