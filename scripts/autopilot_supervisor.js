/**
 * QUANNGUYENS AUTOPILOT SUPERVISOR & CRASH RECOVERY DAEMON
 * 
 * Nhiệm vụ:
 * 1. Giám sát tiến trình Playwright Auto-Pilot 24/7
 * 2. Tự động khởi động lại ngay lập tức nếu tiến trình hoặc trình duyệt bị crash/văng ra ngoài
 * 3. Bảo đảm hệ thống hoạt động liên tục không bao giờ bị dừng
 */

import { spawn } from 'node:child_process'
import path from 'node:path'

let restartCount = 0
let isShuttingDown = false

function startWorker() {
  if (isShuttingDown) return

  restartCount++
  console.log(`\n==============================================================================`)
  console.log(`🛡️ [SUPERVISOR 24/7] Khởi chạy tiến trình AutoPilot (Lần khởi động #${restartCount})`)
  console.log(`⏰ Thời gian: ${new Date().toLocaleString('vi-VN')}`)
  console.log(`==============================================================================\n`)

  const workerScript = path.resolve(process.cwd(), 'scripts/playwright_worker.js')
  const child = spawn(process.execPath, [workerScript], {
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PLAYWRIGHT_AUTO_REPLY: 'true',
    },
  })

  child.on('error', (err) => {
    console.error('❌ [SUPERVISOR] Lỗi khởi động tiến trình con:', err.message)
  })

  child.on('exit', (code, signal) => {
    if (isShuttingDown) {
      console.log('🛑 [SUPERVISOR] Tiến trình đã dừng theo yêu cầu.')
      process.exit(0)
      return
    }

    console.warn(`\n⚠️ ==============================================================================`)
    console.warn(`⚠️ [SUPERVISOR] Tiến trình AutoPilot bị thoát (Mã thoát: ${code}, Tín hiệu: ${signal || 'None'}).`)
    console.warn(`🔄 ĐANG TỰ ĐỘNG KHỞI ĐỘNG LẠI TRÌNH DUYỆT VÀ TIẾN TRÌNH TRONG 3 GIÂY...`)
    console.warn(`==============================================================================\n`)

    setTimeout(() => {
      startWorker()
    }, 3000)
  })
}

// Bắt tín hiệu ngắt từ người dùng để tắt sạch sẽ khi cần
process.on('SIGINT', () => {
  isShuttingDown = true
  console.log('\n🛑 Đang dừng giám sát an toàn...')
  process.exit(0)
})

process.on('SIGTERM', () => {
  isShuttingDown = true
  console.log('\n🛑 Đang dừng giám sát an toàn...')
  process.exit(0)
})

// Bắt đầu giám sát
startWorker()
