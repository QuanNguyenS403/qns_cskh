/**
 * QuanNguyenS CSKH Co-Pilot — Content Script (content.js)
 * Tự động phát hiện tin nhắn, tương tác với AI May và điền nội dung an toàn vào Meta Business Suite / Messenger
 */

(() => {
  // Tránh inject trùng lặp
  if (document.getElementById('qns-copilot-container') || document.getElementById('qns-copilot-pill')) {
    return
  }

  let isMinimized = false
  let isCallingAi = false
  let lastExtractedMessage = ''
  let currentCustomerName = ''

  // ── 1. TẠO GIAO DIỆN WIDGET CO-PILOT ────────────────────────────
  const container = document.createElement('div')
  container.id = 'qns-copilot-container'
  container.innerHTML = `
    <div class="qns-header" id="qns-header-drag">
      <div class="qns-header-title">
        <span class="qns-logo-badge">QNS</span>
        <span>Co-Pilot May</span>
        <span class="qns-status-indicator" id="qns-status" title="Đang kiểm tra kết nối server..."></span>
      </div>
      <div class="qns-header-controls">
        <button class="qns-btn-icon" id="qns-btn-refresh-health" title="Kiểm tra lại kết nối">🔄</button>
        <button class="qns-btn-icon" id="qns-btn-minimize" title="Thu nhỏ (Alt+M)">_</button>
      </div>
    </div>

    <div class="qns-context-bar">
      <div class="qns-customer-info">
        Khách hàng: <span class="qns-customer-highlight" id="qns-customer-name">Đang quét...</span>
      </div>
      <button class="qns-btn-secondary" id="qns-btn-scan" style="padding: 2px 8px; font-size: 10px;" title="Quét tin nhắn mới nhất">
        🔍 Quét chat
      </button>
    </div>

    <div class="qns-toast" id="qns-toast">Đã điền vào ô chat!</div>

    <div class="qns-body">
      <!-- Tin nhắn gần nhất của khách -->
      <div class="qns-customer-quote" id="qns-quote-box">
        <div class="qns-quote-label">Tin nhắn khách gần nhất:</div>
        <div id="qns-last-message-text">Chưa phát hiện tin nhắn. Bấm "Quét chat" hoặc click vào hội thoại.</div>
      </div>

      <!-- Quick Action Chips -->
      <div class="qns-chips-row">
        <button class="qns-chip" data-prompt="mua quần áo">👗 3 Set Pijama</button>
        <button class="qns-chip" data-prompt="Tư vấn size theo chiều cao cân nặng">📏 Bảng Size</button>
        <button class="qns-chip" data-prompt="Freeship từ bao nhiêu và có bớt giá không">🚚 Freeship & Sale</button>
        <button class="qns-chip" data-prompt="Chính sách đổi trả hàng">🔄 Đổi trả 7 ngày</button>
        <button class="qns-chip" data-prompt="Xin số tài khoản ngân hàng chuyển khoản">🏦 STK / VietQR</button>
      </div>

      <!-- Khung gợi ý của May -->
      <div class="qns-preview-container">
        <div class="qns-preview-label-row">
          <span>💡 Gợi ý phản hồi từ May:</span>
          <span style="font-size: 10px; font-weight: normal; color: #94a3b8;">Có thể chỉnh sửa</span>
        </div>
        <textarea class="qns-preview-textarea" id="qns-preview-text" placeholder="Bấm 'Hỏi May' hoặc chọn nhanh ở trên để tạo câu trả lời..."></textarea>
      </div>

      <!-- Nút hành động -->
      <div class="qns-actions-row">
        <button class="qns-btn-primary" id="qns-btn-fill" title="Phím tắt: Alt + A">
          ✍️ Điền vào chat <span style="opacity: 0.7; font-size: 10px;">(Alt+A)</span>
        </button>
        <button class="qns-btn-success" id="qns-btn-send" title="Phím tắt: Alt + Enter">
          🚀 Điền & Gửi luôn <span style="opacity: 0.7; font-size: 10px;">(Alt+⏎)</span>
        </button>
      </div>

      <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 2px;">
        <button class="qns-btn-secondary" id="qns-btn-ask-ai" style="flex: 1; margin-right: 6px;">
          ⚡ Hỏi May phân tích lại (Alt+S)
        </button>
        <button class="qns-btn-secondary" id="qns-btn-copy" style="padding: 6px 12px;" title="Sao chép vào clipboard">
          📋 Copy
        </button>
      </div>
    </div>
  `

  // Nút nổi khi thu nhỏ
  const pill = document.createElement('div')
  pill.id = 'qns-copilot-pill'
  pill.style.display = 'none'
  pill.innerHTML = `
    <span class="qns-logo-badge">QNS</span>
    <span>May Co-Pilot</span>
    <span class="qns-status-indicator" id="qns-pill-status"></span>
  `

  document.body.appendChild(container)
  document.body.appendChild(pill)

  // ── 2. CÁC PHẦN TỬ DOM CỦA WIDGET ──────────────────────────────
  const elStatus = document.getElementById('qns-status')
  const elPillStatus = document.getElementById('qns-pill-status')
  const elCustomerName = document.getElementById('qns-customer-name')
  const elLastMsg = document.getElementById('qns-last-message-text')
  const elPreview = document.getElementById('qns-preview-text')
  const elBtnScan = document.getElementById('qns-btn-scan')
  const elBtnAskAi = document.getElementById('qns-btn-ask-ai')
  const elBtnFill = document.getElementById('qns-btn-fill')
  const elBtnSend = document.getElementById('qns-btn-send')
  const elBtnCopy = document.getElementById('qns-btn-copy')
  const elBtnMinimize = document.getElementById('qns-btn-minimize')
  const elBtnRefresh = document.getElementById('qns-btn-refresh-health')
  const elToast = document.getElementById('qns-toast')

  function showToast(msg) {
    elToast.textContent = msg
    elToast.classList.add('show')
    setTimeout(() => elToast.classList.remove('show'), 2200)
  }

  // ── 3. KIỂM TRA SỨC KHỎE SERVER ────────────────────────────────
  function checkServerHealth() {
    chrome.runtime.sendMessage({ action: 'CHECK_SERVER_HEALTH' }, (res) => {
      if (res && res.success) {
        elStatus.classList.remove('offline')
        elPillStatus.classList.remove('offline')
        elStatus.title = `Server hoạt động tại ${res.url}`
      } else {
        elStatus.classList.add('offline')
        elPillStatus.classList.add('offline')
        elStatus.title = res?.error || 'Không kết nối được server!'
      }
    })
  }
  checkServerHealth()
  elBtnRefresh.addEventListener('click', () => {
    checkServerHealth()
    showToast('Đang kiểm tra kết nối server...')
  })

  // ── 4. THU NHỎ / PHÓNG TO ──────────────────────────────────────
  function toggleMinimize() {
    isMinimized = !isMinimized
    if (isMinimized) {
      container.style.display = 'none'
      pill.style.display = 'flex'
    } else {
      container.style.display = 'flex'
      pill.style.display = 'none'
      scanConversation()
    }
  }
  elBtnMinimize.addEventListener('click', toggleMinimize)
  pill.addEventListener('click', toggleMinimize)

  // ── 5. BỘ TRÍCH XUẤT DOM THÔNG MINH CHO META / MESSENGER ───────
  function findChatEditor() {
    // 1. Selector chuẩn Draft.js / Lexical trong Meta Business Suite Inbox
    const selectors = [
      'div[role="textbox"][contenteditable="true"]',
      'div[contenteditable="true"][aria-label*="nhắn"]',
      'div[contenteditable="true"][aria-label*="Nhắn"]',
      'div[contenteditable="true"][aria-label*="Message"]',
      'div[contenteditable="true"][aria-label*="message"]',
      'div[contenteditable="true"][data-lexical-editor="true"]',
      'div[contenteditable="true"]',
      'textarea[placeholder*="tin nhắn"]',
      'textarea[placeholder*="message"]',
    ]

    for (const sel of selectors) {
      const el = document.querySelector(sel)
      if (el && el.offsetParent !== null) {
        return el
      }
    }
    return null
  }

  function scanConversation() {
    // 1. Tìm tên khách hàng
    const nameSelectors = [
      // Meta Business Suite Header
      'div[role="main"] h1',
      'div[role="main"] h2',
      'div[role="main"] header h1',
      'div[role="main"] header h2',
      'div[role="banner"] h1',
      // Thẻ chứa tên khách trong chi tiết hội thoại
      'span[dir="auto"].x193iq5w',
      'h2[dir="auto"]',
      'h1[dir="auto"]',
    ]

    let foundName = ''
    for (const sel of nameSelectors) {
      const elements = document.querySelectorAll(sel)
      for (const el of elements) {
        const text = el.innerText?.trim()
        if (text && text.length > 1 && text.length < 40 && !/hộp thư|inbox|tìm kiếm|messenger|instagram|tất cả/i.test(text)) {
          foundName = text
          break
        }
      }
      if (foundName) break
    }

    if (foundName) {
      currentCustomerName = foundName
      elCustomerName.textContent = foundName
    } else if (!currentCustomerName) {
      elCustomerName.textContent = 'Khách hàng'
    }

    // 2. Tìm tin nhắn gần nhất của khách
    // Trong Meta Business Suite, tin nhắn của khách nằm bên trái (thường có nền trắng/xám hoặc không có background xanh của shop)
    const messageBlocks = document.querySelectorAll('div[dir="auto"]')
    const candidates = []

    for (const block of messageBlocks) {
      // Loại bỏ các đoạn text là tên, giờ, menu, badge
      const text = block.innerText?.trim()
      if (!text || text.length < 2 || text.length > 400) continue
      if (/^(hôm nay|thứ|tin nhắn|đã xem|trả lời|quản lý|chưa đọc|ưu tiên|\d{1,2}:\d{2})/i.test(text)) continue
      if (text === foundName) continue

      // Kiểm tra có nằm trong vùng chat không
      const rect = block.getBoundingClientRect()
      if (rect.top > 80 && rect.bottom < window.innerHeight - 80) {
        candidates.push({ text, top: rect.top, bottom: rect.bottom })
      }
    }

    if (candidates.length > 0) {
      // Lấy phần tử nằm gần dưới cùng nhất (tin nhắn mới nhất)
      candidates.sort((a, b) => b.bottom - a.bottom)
      const latest = candidates[0].text
      if (latest && latest !== lastExtractedMessage) {
        lastExtractedMessage = latest
        elLastMsg.textContent = `"${latest}"`
        return latest
      }
    }

    return lastExtractedMessage || null
  }

  elBtnScan.addEventListener('click', () => {
    const text = scanConversation()
    if (text) {
      showToast('Đã phát hiện tin nhắn mới!')
    } else {
      showToast('Chưa tìm thấy tin nhắn mới, hãy chọn hội thoại!')
    }
  })

  // ── 6. GỌI AI MAY ĐỂ TƯ VẤN ────────────────────────────────────
  function askMay(customPrompt = null) {
    if (isCallingAi) return
    isCallingAi = true

    const promptText = customPrompt || lastExtractedMessage || 'Mua quần áo'
    elBtnAskAi.innerHTML = '<span class="qns-spinner"></span> Đang hỏi May...'
    elPreview.value = 'Đang phân tích thông số, bảng size và catalog QuanNguyenS...'

    chrome.runtime.sendMessage(
      {
        action: 'CALL_MAY_API',
        message: promptText,
        customerName: currentCustomerName || null,
        channel: 'copilot',
      },
      (res) => {
        isCallingAi = false
        elBtnAskAi.textContent = '⚡ Hỏi May phân tích lại (Alt+S)'

        if (res && res.success && res.customer_message) {
          elPreview.value = res.customer_message
          showToast('May đã gợi ý xong câu trả lời!')
        } else {
          elPreview.value = `⚠️ Không thể lấy câu trả lời: ${res?.error || 'Lỗi server'}\nHãy đảm bảo bạn đã chạy server D:\\CSKH tại http://localhost:3002!`
        }
      }
    )
  }

  elBtnAskAi.addEventListener('click', () => {
    scanConversation()
    askMay()
  })

  // Click vào chip gợi ý nhanh
  document.querySelectorAll('.qns-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const prompt = chip.getAttribute('data-prompt')
      askMay(prompt)
    })
  })

  // ── 7. ĐIỀN VĂN BẢN VÀO KHUNG CHAT CỦA FACEBOOK/INSTAGRAM ────────
  function insertTextIntoFacebook(text) {
    if (!text || !text.trim()) {
      showToast('Chưa có nội dung để điền!')
      return false
    }

    const editor = findChatEditor()
    if (!editor) {
      showToast('❌ Không tìm thấy ô nhập tin nhắn trên màn hình!')
      return false
    }

    editor.focus()

    // Cách 1: document.execCommand('insertText') - Tương thích hoàn hảo với Draft.js và Lexical
    let success = false
    try {
      // Chọn toàn bộ văn bản cũ (nếu có) để thay thế hoặc focus cuối
      document.execCommand('selectAll', false, null)
      success = document.execCommand('insertText', false, text)
    } catch (e) {
      success = false
    }

    // Cách 2: Nếu execCommand không thành công, dùng InputEvent chuẩn
    if (!success) {
      try {
        const inputEvent = new InputEvent('insertText', {
          bubbles: true,
          cancelable: true,
          data: text,
        })
        editor.dispatchEvent(inputEvent)
        success = true
      } catch (e) {
        editor.innerText = text
      }
    }

    // Kích hoạt sự kiện input cho React Virtual DOM cập nhật state
    editor.dispatchEvent(new Event('input', { bubbles: true }))
    editor.dispatchEvent(new Event('change', { bubbles: true }))

    showToast('✅ Đã điền xong vào ô chat!')
    return true
  }

  elBtnFill.addEventListener('click', () => {
    const text = elPreview.value.trim()
    insertTextIntoFacebook(text)
  })

  // ── 8. ĐIỀN VÀ GỬI LUÔN (Alt + Enter) ─────────────────────────
  function fillAndSend() {
    const text = elPreview.value.trim()
    const ok = insertTextIntoFacebook(text)
    if (!ok) return

    setTimeout(() => {
      const editor = findChatEditor()
      if (!editor) return

      editor.focus()
      // Mô phỏng phím Enter
      const enterDown = new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
      })
      const enterUp = new KeyboardEvent('keyup', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
      })

      editor.dispatchEvent(enterDown)
      editor.dispatchEvent(enterUp)
      showToast('🚀 Đã kích hoạt lệnh gửi tin nhắn!')
    }, 150)
  }

  elBtnSend.addEventListener('click', fillAndSend)

  // ── 9. NÚT SAO CHÉP (COPY TO CLIPBOARD) ────────────────────────
  elBtnCopy.addEventListener('click', () => {
    const text = elPreview.value.trim()
    if (!text) {
      showToast('Không có nội dung để copy!')
      return
    }
    navigator.clipboard.writeText(text).then(() => {
      showToast('📋 Đã copy vào bộ nhớ đệm!')
    })
  })

  // ── 10. PHÍM TẮT TOÀN CỤC (HOTKEYS) ───────────────────────────
  window.addEventListener('keydown', (e) => {
    // Alt + S: Quét & Hỏi May
    if (e.altKey && (e.key === 's' || e.key === 'S')) {
      e.preventDefault()
      scanConversation()
      askMay()
    }

    // Alt + A: Điền vào ô chat
    if (e.altKey && (e.key === 'a' || e.key === 'A')) {
      e.preventDefault()
      const text = elPreview.value.trim()
      insertTextIntoFacebook(text)
    }

    // Alt + Enter: Điền & Gửi luôn
    if (e.altKey && e.key === 'Enter') {
      e.preventDefault()
      fillAndSend()
    }

    // Alt + M: Thu nhỏ / Mở rộng widget
    if (e.altKey && (e.key === 'm' || e.key === 'M')) {
      e.preventDefault()
      toggleMinimize()
    }
  })

  // ── 11. TỰ ĐỘNG THEO DÕI SỰ THAY ĐỔI URL HOẶC CHUYỂN HỘI THOẠI ─
  let lastUrl = location.href
  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href
      setTimeout(scanConversation, 800)
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })

  // Quét ban đầu sau khi trang tải xong
  setTimeout(scanConversation, 1500)
})()
