/**
 * QuanNguyenS CSKH Co-Pilot & Auto-Pilot — Content Script (content.js)
 * Tự động phát hiện tin nhắn khách hàng, phân biệt tin của Shop vs Khách,
 * Hỗ trợ cả 2 chế độ:
 * 1. Bán tự động (Co-Pilot): Gợi ý phản hồi và hỗ trợ phím tắt Alt+A, Alt+Enter.
 * 2. Tự động 100% (Auto-Pilot): Tự quét, tự gọi QNS, tự đếm ngược 3s và tự gửi tin nhắn cho khách!
 */

(() => {
  // Tránh inject trùng lặp
  if (document.getElementById('qns-copilot-container') || document.getElementById('qns-copilot-pill')) {
    return
  }

  let isMinimized = false
  let isCallingAi = false
  let autoPilotEnabled = false
  let countdownTimer = null
  let lastCustomerMessage = ''
  let currentCustomerName = ''
  let lastAutoRepliedMessage = ''

  // ── 1. TẠO GIAO DIỆN WIDGET CO-PILOT & AUTO-PILOT ─────────────────
  const container = document.createElement('div')
  container.id = 'qns-copilot-container'
  container.innerHTML = `
    <div class="qns-header" id="qns-header-drag">
      <div class="qns-header-title">
        <span class="qns-logo-badge">QNS</span>
        <span>Co-Pilot QNS</span>
        <span class="qns-status-indicator" id="qns-status" title="Đang kiểm tra kết nối server..."></span>
      </div>
      <div class="qns-header-controls">
        <button class="qns-btn-icon" id="qns-btn-refresh-health" title="Kiểm tra kết nối server">🔄</button>
        <button class="qns-btn-icon" id="qns-btn-minimize" title="Thu nhỏ (Alt+M)">_</button>
      </div>
    </div>

    <!-- Thanh trạng thái khách hàng & Công tắc Auto-Pilot -->
    <div class="qns-context-bar">
      <div class="qns-customer-info">
        Khách: <span class="qns-customer-highlight" id="qns-customer-name">Đang quét...</span>
      </div>
      
      <!-- Công tắc Tự động 100% -->
      <div style="display: flex; align-items: center; gap: 6px;">
        <label class="qns-switch" title="Gạt sang phải để BẬT chế độ Tự động gửi 100% không cần bấm nút!">
          <input type="checkbox" id="qns-autopilot-toggle">
          <span class="qns-slider"></span>
        </label>
        <span style="font-size: 11px; font-weight: 700; color: #475569;" id="qns-autopilot-text">Auto: TẮT</span>
      </div>
    </div>

    <div class="qns-toast" id="qns-toast">Đã điền vào ô chat!</div>

    <div class="qns-body">
      <!-- Thanh đếm ngược tự động gửi (Khi Auto-Pilot BẬT) -->
      <div class="qns-countdown-bar" id="qns-countdown-box" style="display: none;">
        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; font-weight: 600;">
          <span id="qns-countdown-msg">🚀 Tự động gửi sau 3s...</span>
          <button id="qns-btn-cancel-auto" style="background: #ef4444; color: #fff; border: none; border-radius: 4px; padding: 2px 8px; font-size: 10px; cursor: pointer;">Hủy gửi</button>
        </div>
        <div class="qns-progress-track">
          <div class="qns-progress-fill" id="qns-progress-fill"></div>
        </div>
      </div>

      <!-- Tin nhắn gần nhất của khách (Phân biệt chuẩn xác giữa Khách vs Shop) -->
      <div class="qns-customer-quote" id="qns-quote-box">
        <div class="qns-quote-label" id="qns-quote-header">Tin nhắn khách gần nhất:</div>
        <div id="qns-last-message-text">Chưa phát hiện tin nhắn. Bấm vào cuộc trò chuyện bất kỳ...</div>
      </div>

      <!-- Quick Action Chips -->
      <div class="qns-chips-row">
        <button class="qns-chip" data-prompt="mua quần áo">👗 3 Set Pijama</button>
        <button class="qns-chip" data-prompt="Tư vấn size theo chiều cao cân nặng">📏 Bảng Size</button>
        <button class="qns-chip" data-prompt="Freeship từ bao nhiêu và có bớt giá không">🚚 Freeship & Sale</button>
        <button class="qns-chip" data-prompt="Chính sách đổi trả hàng">🔄 Đổi trả 7 ngày</button>
        <button class="qns-chip" data-prompt="Xin số tài khoản ngân hàng chuyển khoản">🏦 STK / VietQR</button>
      </div>

      <!-- Khung gợi ý của QNS -->
      <div class="qns-preview-container">
        <div class="qns-preview-label-row">
          <span>💡 Gợi ý phản hồi từ QNS:</span>
          <span style="font-size: 10px; font-weight: normal; color: #94a3b8;">Có thể chỉnh sửa</span>
        </div>
        <textarea class="qns-preview-textarea" id="qns-preview-text" placeholder="Bấm 'Hỏi QNS' hoặc chọn nhanh ở trên để tạo câu trả lời..."></textarea>
      </div>

      <!-- Nút hành động thủ công -->
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
          ⚡ Hỏi QNS phân tích lại (Alt+S)
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
    <span>QNS Co-Pilot</span>
    <span class="qns-status-indicator" id="qns-pill-status"></span>
  `

  document.body.appendChild(container)
  document.body.appendChild(pill)

  // ── 2. CÁC PHẦN TỬ DOM CỦA WIDGET ──────────────────────────────
  const elStatus = document.getElementById('qns-status')
  const elPillStatus = document.getElementById('qns-pill-status')
  const elCustomerName = document.getElementById('qns-customer-name')
  const elLastMsg = document.getElementById('qns-last-message-text')
  const elQuoteHeader = document.getElementById('qns-quote-header')
  const elPreview = document.getElementById('qns-preview-text')
  const elBtnAskAi = document.getElementById('qns-btn-ask-ai')
  const elBtnFill = document.getElementById('qns-btn-fill')
  const elBtnSend = document.getElementById('qns-btn-send')
  const elBtnCopy = document.getElementById('qns-btn-copy')
  const elBtnMinimize = document.getElementById('qns-btn-minimize')
  const elBtnRefresh = document.getElementById('qns-btn-refresh-health')
  const elToast = document.getElementById('qns-toast')
  const elAutopilotToggle = document.getElementById('qns-autopilot-toggle')
  const elAutopilotText = document.getElementById('qns-autopilot-text')
  const elCountdownBox = document.getElementById('qns-countdown-box')
  const elCountdownMsg = document.getElementById('qns-countdown-msg')
  const elProgressFill = document.getElementById('qns-progress-fill')
  const elBtnCancelAuto = document.getElementById('qns-btn-cancel-auto')

  function showToast(msg) {
    elToast.textContent = msg
    elToast.classList.add('show')
    setTimeout(() => elToast.classList.remove('show'), 2200)
  }

  // Khôi phục trạng thái Auto-Pilot từ storage
  chrome.storage.local.get(['qnsAutoPilot'], (res) => {
    if (res && res.qnsAutoPilot) {
      autoPilotEnabled = true
      elAutopilotToggle.checked = true
      elAutopilotText.textContent = 'Auto: BẬT 🟢'
      elAutopilotText.style.color = '#059669'
    }
  })

  // Bật/Tắt công tắc Auto-Pilot
  elAutopilotToggle.addEventListener('change', () => {
    autoPilotEnabled = elAutopilotToggle.checked
    chrome.storage.local.set({ qnsAutoPilot: autoPilotEnabled })
    if (autoPilotEnabled) {
      elAutopilotText.textContent = 'Auto: BẬT 🟢'
      elAutopilotText.style.color = '#059669'
      showToast('⚡ Chế độ Auto-Pilot ĐÃ BẬT: Sẽ tự động trả lời khi khách nhắn!')
      scanConversation()
    } else {
      elAutopilotText.textContent = 'Auto: TẮT'
      elAutopilotText.style.color = '#475569'
      cancelCountdown()
      showToast('Đã chuyển về chế độ Bán tự động (Co-Pilot)')
    }
  })

  // Hủy gửi tự động
  function cancelCountdown() {
    if (countdownTimer) {
      clearTimeout(countdownTimer)
      countdownTimer = null
    }
    elCountdownBox.style.display = 'none'
  }
  elBtnCancelAuto.addEventListener('click', () => {
    cancelCountdown()
    showToast('Đã hủy lần gửi tự động này!')
  })

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

  // ── 5. BỘ TRÍCH XUẤT DOM THÔNG MINH (PHÂN BIỆT KHÁCH VS SHOP) ───
  function findChatEditor() {
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

  // Nhận diện xem một đoạn tin nhắn có phải do Shop gửi không
  function isShopSignature(text) {
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
      lower.includes('tư vấn size theo chiều cao cân nặng')
    )
  }

  function scanConversation() {
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

    // 2. Tìm danh sách tin nhắn trong khung chat
    const editor = findChatEditor()
    const chatContainer = editor ? editor.closest('div[role="main"]') || document.body : document.body
    const chatBounds = chatContainer.getBoundingClientRect()
    const chatMidX = chatBounds.left + chatBounds.width / 2

    const messageBlocks = document.querySelectorAll('div[dir="auto"]')
    const messages = []

    for (const block of messageBlocks) {
      const text = block.innerText?.trim()
      if (!text || text.length < 2 || text.length > 600) continue
      if (/^(hôm nay|thứ|tin nhắn|đã xem|trả lời|quản lý|chưa đọc|ưu tiên|\d{1,2}:\d{2})/i.test(text)) continue
      if (text === foundName) continue

      const rect = block.getBoundingClientRect()
      // Nằm trong vùng cuộn chat
      if (rect.top > 80 && rect.bottom < window.innerHeight - 80) {
        // Phân biệt vị trí: Khách nằm bên trái (bubbleMidX < chatMidX), Shop nằm bên phải (bubbleMidX > chatMidX)
        const bubbleMidX = rect.left + rect.width / 2
        const isAlignedRight = bubbleMidX > chatMidX - 30
        const isFromShop = isShopSignature(text) || isAlignedRight

        messages.push({
          text,
          isFromShop,
          isFromCustomer: !isFromShop,
          bottom: rect.bottom,
        })
      }
    }

    if (messages.length === 0) return null

    // Sắp xếp theo thứ tự từ trên xuống dưới (bottom tăng dần)
    messages.sort((a, b) => a.bottom - b.bottom)
    const lastMsg = messages[messages.length - 1]

    // Tìm tin nhắn gần nhất của KHÁCH HÀNG (bỏ qua tin của shop)
    let latestCustomerMsg = null
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].isFromCustomer) {
        latestCustomerMsg = messages[i]
        break
      }
    }

    if (!latestCustomerMsg) {
      elQuoteHeader.textContent = 'Trạng thái hội thoại:'
      elLastMsg.textContent = 'Chưa tìm thấy tin nhắn đến từ khách hàng.'
      return null
    }

    lastCustomerMessage = latestCustomerMsg.text

    // Kiểm tra xem tin nhắn CUỐI CÙNG của cuộc hội thoại là của ai:
    if (lastMsg.isFromShop) {
      // Shop đã trả lời xong! Không cần trả lời nữa, chờ khách nhắn thêm
      elQuoteHeader.textContent = 'Khách đã nhắn gần nhất:'
      elLastMsg.innerHTML = `"${latestCustomerMsg.text}" <br><span style="color: #059669; font-weight: 600; font-size: 11px;">✓ Shop đã phản hồi. Đang chờ khách nhắn lại...</span>`
      cancelCountdown()
      return latestCustomerMsg.text
    }

    // Tin nhắn cuối cùng CHÍNH LÀ KHÁCH HÀNG! -> Khách đang đợi trả lời!
    elQuoteHeader.textContent = 'Khách đang chờ trả lời:'
    elLastMsg.innerHTML = `"${latestCustomerMsg.text}" <br><span style="color: #dc2626; font-weight: 700; font-size: 11px;">⚡ Khách mới nhắn, chưa có phản hồi!</span>`

    // NẾU ĐANG BẬT CHẾ ĐỘ AUTO-PILOT (TỰ ĐỘNG 100%):
    if (autoPilotEnabled && latestCustomerMsg.text !== lastAutoRepliedMessage && !isCallingAi && !countdownTimer) {
      triggerAutoPilot(latestCustomerMsg.text)
    }

    return latestCustomerMsg.text
  }

  // ── 6. CƠ CHẾ AUTO-PILOT (TỰ ĐỘNG 100% ĐẾM NGƯỢC VÀ GỬI) ───────
  function triggerAutoPilot(customerText) {
    cancelCountdown()
    elCountdownBox.style.display = 'flex'
    elCountdownMsg.textContent = '⚡ Đang gọi QNS phân tích tin nhắn...'
    elProgressFill.style.width = '0%'

    askQns(customerText, (generatedText) => {
      if (!generatedText || !autoPilotEnabled) {
        cancelCountdown()
        return
      }

      // Điền sẵn vào khung chat
      insertTextIntoFacebook(generatedText)

      // Bắt đầu đếm ngược 3 giây với hiệu ứng tiến trình
      let secondsLeft = 3
      elCountdownMsg.textContent = `🚀 Auto-Pilot: Sẽ tự gửi sau ${secondsLeft}s...`
      elProgressFill.style.transition = 'width 3s linear'
      elProgressFill.style.width = '100%'

      const intervalId = setInterval(() => {
        secondsLeft--
        if (secondsLeft > 0) {
          elCountdownMsg.textContent = `🚀 Auto-Pilot: Sẽ tự gửi sau ${secondsLeft}s...`
        } else {
          clearInterval(intervalId)
        }
      }, 1000)

      countdownTimer = setTimeout(() => {
        clearInterval(intervalId)
        countdownTimer = null
        elCountdownBox.style.display = 'none'

        if (autoPilotEnabled) {
          submitSend()
          lastAutoRepliedMessage = customerText
          showToast('🚀 ĐÃ TỰ ĐỘNG GỬI TIN NHẮN CHO KHÁCH!')
          setTimeout(scanConversation, 1500)
        }
      }, 3100)
    })
  }

  // ── 7. GỌI AI QNS ĐỂ TƯ VẤN ────────────────────────────────────
  function askQns(customPrompt = null, onComplete = null) {
    if (isCallingAi) return
    isCallingAi = true

    const promptText = customPrompt || lastCustomerMessage || 'Mua quần áo'
    elBtnAskAi.innerHTML = '<span class="qns-spinner"></span> Đang hỏi QNS...'
    elPreview.value = 'Đang phân tích thông số, bảng size và catalog QuanNguyenS...'

    chrome.runtime.sendMessage(
      {
        action: 'CALL_QNS_API',
        message: promptText,
        customerName: currentCustomerName || null,
        channel: 'copilot',
      },
      (res) => {
        isCallingAi = false
        elBtnAskAi.textContent = '⚡ Hỏi QNS phân tích lại (Alt+S)'

        if (res && res.success && res.customer_message) {
          elPreview.value = res.customer_message
          if (onComplete) onComplete(res.customer_message)
          else showToast('QNS đã gợi ý xong câu trả lời!')
        } else {
          elPreview.value = `⚠️ Không thể lấy câu trả lời: ${res?.error || 'Lỗi server'}\nHãy đảm bảo bạn đã chạy server D:\\CSKH tại http://localhost:3002!`
          if (onComplete) onComplete(null)
        }
      }
    )
  }

  elBtnAskAi.addEventListener('click', () => {
    scanConversation()
    askQns()
  })

  // Click vào chip gợi ý nhanh
  document.querySelectorAll('.qns-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const prompt = chip.getAttribute('data-prompt')
      askQns(prompt)
    })
  })

  // ── 8. ĐIỀN VĂN BẢN VÀO KHUNG CHAT ──────────────────────────────
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

    let success = false
    try {
      document.execCommand('selectAll', false, null)
      success = document.execCommand('insertText', false, text)
    } catch (e) {
      success = false
    }

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

    editor.dispatchEvent(new Event('input', { bubbles: true }))
    editor.dispatchEvent(new Event('change', { bubbles: true }))

    showToast('✅ Đã điền xong vào ô chat!')
    return true
  }

  elBtnFill.addEventListener('click', () => {
    const text = elPreview.value.trim()
    insertTextIntoFacebook(text)
  })

  // ── 9. KÍCH HOẠT GỬI TIN NHẮN (SUBMIT) ───────────────────────────
  function submitSend() {
    const editor = findChatEditor()
    if (!editor) return

    editor.focus()
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
  }

  function fillAndSend() {
    const text = elPreview.value.trim()
    const ok = insertTextIntoFacebook(text)
    if (!ok) return

    setTimeout(() => {
      submitSend()
      showToast('🚀 Đã kích hoạt lệnh gửi tin nhắn!')
    }, 150)
  }

  elBtnSend.addEventListener('click', fillAndSend)

  // ── 10. SAO CHÉP (COPY TO CLIPBOARD) ───────────────────────────
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

  // ── 11. PHÍM TẮT TOÀN CỤC (HOTKEYS) ────────────────────────────
  window.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 's' || e.key === 'S')) {
      e.preventDefault()
      scanConversation()
      askQns()
    }

    if (e.altKey && (e.key === 'a' || e.key === 'A')) {
      e.preventDefault()
      const text = elPreview.value.trim()
      insertTextIntoFacebook(text)
    }

    if (e.altKey && e.key === 'Enter') {
      e.preventDefault()
      fillAndSend()
    }

    if (e.altKey && (e.key === 'm' || e.key === 'M')) {
      e.preventDefault()
      toggleMinimize()
    }
  })

  // ── 12. VÒNG LẶP THEO DÕI TIN NHẮN TỰ ĐỘNG (BACKGROUND POLLER) ───
  // Định kỳ quét mỗi 2.5 giây để nếu có khách mới nhắn, Auto-Pilot sẽ bắt được ngay
  setInterval(() => {
    scanConversation()
  }, 2500)

  // Theo dõi chuyển đổi URL hội thoại
  let lastUrl = location.href
  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href
      setTimeout(scanConversation, 800)
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })

  // Quét ban đầu
  setTimeout(scanConversation, 1500)
})()
