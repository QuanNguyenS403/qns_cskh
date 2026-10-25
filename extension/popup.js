document.addEventListener('DOMContentLoaded', async () => {
  const badge = document.getElementById('status-badge')
  const urlDisplay = document.getElementById('server-url-display')
  const urlInput = document.getElementById('server-url-input')
  const btnSave = document.getElementById('btn-save-url')

  // Load saved URL
  const stored = await chrome.storage.local.get(['cskhServerUrl'])
  const currentUrl = stored.cskhServerUrl || 'http://localhost:3002'
  urlInput.value = currentUrl
  urlDisplay.textContent = currentUrl

  // Check health
  chrome.runtime.sendMessage({ action: 'CHECK_SERVER_HEALTH' }, (res) => {
    if (res && res.success) {
      badge.textContent = '🟢 Đang chạy'
      badge.className = 'status-badge online'
    } else {
      badge.textContent = '🔴 Chưa kết nối'
      badge.className = 'status-badge offline'
      badge.title = res?.error || 'Không kết nối được server'
    }
  })

  // Save new URL
  btnSave.addEventListener('click', async () => {
    const newUrl = urlInput.value.trim().replace(/\/$/, '')
    if (!newUrl) return
    await chrome.storage.local.set({ cskhServerUrl: newUrl })
    urlDisplay.textContent = newUrl
    badge.textContent = 'Đang kiểm tra...'
    badge.className = 'status-badge'

    chrome.runtime.sendMessage({ action: 'CHECK_SERVER_HEALTH' }, (res) => {
      if (res && res.success) {
        badge.textContent = '🟢 Đang chạy'
        badge.className = 'status-badge online'
      } else {
        badge.textContent = '🔴 Lỗi'
        badge.className = 'status-badge offline'
      }
    })
  })
})
