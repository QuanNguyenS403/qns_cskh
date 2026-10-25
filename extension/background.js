/**
 * QuanNguyenS CSKH Co-Pilot — Service Worker (background.js)
 * Cầu nối trung gian an toàn giữa Web Content Script và Local CSKH Server (localhost:3002)
 */

const DEFAULT_SERVER_URL = 'http://localhost:3002'

// Lấy URL server từ bộ nhớ local (nếu người dùng đổi port hoặc domain)
async function getServerUrl() {
  try {
    const res = await chrome.storage.local.get(['cskhServerUrl'])
    return res.cskhServerUrl || DEFAULT_SERVER_URL
  } catch (e) {
    return DEFAULT_SERVER_URL
  }
}

// Lắng nghe yêu cầu từ Content Script hoặc Popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'CALL_QNS_API' || request.action === 'CALL_MAY_API') {
    handleCallQns(request)
      .then(sendResponse)
      .catch((err) => sendResponse({ success: false, error: err.message }))
    return true // Giữ kênh async
  }

  if (request.action === 'CHECK_SERVER_HEALTH') {
    checkHealth()
      .then(sendResponse)
      .catch((err) => sendResponse({ success: false, error: err.message }))
    return true
  }
})

async function checkHealth() {
  const baseUrl = await getServerUrl()
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 3500)
    
    const res = await fetch(`${baseUrl}/livez`, {
      method: 'GET',
      signal: controller.signal,
    })
    clearTimeout(timeoutId)

    if (res.ok) {
      const data = await res.json()
      return { success: true, status: data.status || 'alive', url: baseUrl }
    }
    return { success: false, error: `Server trả về mã ${res.status}`, url: baseUrl }
  } catch (err) {
    return {
      success: false,
      error: 'Không thể kết nối tới server D:\\CSKH tại ' + baseUrl + '. Hãy kiểm tra server đã được bật (npm start hoặc start_production.bat)!',
      url: baseUrl,
    }
  }
}

async function handleCallQns({ message, customerName, channel = 'copilot', history = [] }) {
  const baseUrl = await getServerUrl()
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15000)

    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message,
        channel,
        customerName: customerName || null,
        isCopilot: true,
        history: Array.isArray(history) ? history : [],
      }),
      signal: controller.signal,
    })
    clearTimeout(timeoutId)

    const json = await res.json()
    if (!res.ok || !json.success) {
      throw new Error(json.error || `Server lỗi mã ${res.status}`)
    }

    return {
      success: true,
      customer_message: json.customer_message || '',
      intent_codes: json.intent_codes || [],
      evidence_refs: json.evidence_refs || [],
      next_step: json.next_step || 'INFORM',
    }
  } catch (err) {
    console.error('[QNS Background Error]:', err)
    return {
      success: false,
      error: err.name === 'AbortError'
        ? 'Quá thời gian chờ phản hồi từ server (15s).'
        : `Lỗi kết nối tới server CSKH (${err.message})`,
    }
  }
}
