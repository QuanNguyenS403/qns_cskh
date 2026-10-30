import { autoPilotService } from '../src/automation/autoPilotService.js'

/**
 * Worker chạy nền tự động hóa 24/7 với Playwright
 * Có thể chạy độc lập qua PM2 hoặc file .bat
 */
async function run() {
  console.log('\n======================================================')
  console.log('🤖 QUANNGUYENS AI CSKH - PLAYWRIGHT AUTONOMOUS 24/7 WORKER')
  console.log('   Tự động quét và trả lời Fanpage Messenger & Instagram Direct')
  console.log('======================================================\n')

  try {
    await autoPilotService.start()

    const cleanup = async () => {
      console.log('\n🛑 Đang nhận tín hiệu dừng, tiến hành giải phóng tài nguyên...')
      await autoPilotService.stop()
      process.exit(0)
    }

    process.on('SIGINT', cleanup)
    process.on('SIGTERM', cleanup)
  } catch (err) {
    console.error('❌ [FATAL WORKER ERROR]:', err)
    process.exit(1)
  }
}

run()
