import { BrowserManager } from '../src/automation/browserManager.js'
import { MetaBusinessSuiteAgent } from '../src/automation/metaBusinessSuiteAgent.js'
import readline from 'node:readline'

/**
 * Script đăng nhập tài khoản Meta một lần duy nhất
 * Chạy ở chế độ Headed (mở cửa sổ trình duyệt thật) để người quản trị đăng nhập,
 * sau đó tự động lưu Cookie & LocalStorage vào file và thư mục profile bền vững.
 */
async function main() {
  console.log('\n======================================================')
  console.log('🔑 QUANNGUYENS AI CSKH - PLAYWRIGHT INTERACTIVE LOGIN')
  console.log('   Mở trình duyệt thực để đăng nhập tài khoản Meta & Fanpage')
  console.log('======================================================\n')

  const browserManager = new BrowserManager({ headless: false })
  const metaAgent = new MetaBusinessSuiteAgent()

  try {
    console.log('🌐 Đang khởi động trình duyệt Chrome/Edge...')
    await browserManager.init()
    const page = await browserManager.getPage()

    console.log('👉 Đang mở Hộp thư Meta Business Suite: https://business.facebook.com/latest/inbox/all')
    await page.goto('https://business.facebook.com/latest/inbox/all', { waitUntil: 'domcontentloaded' })

    console.log('\n------------------------------------------------------')
    console.log('📌 HƯỚNG DẪN:')
    console.log('1. Trên cửa sổ trình duyệt vừa mở, hãy đăng nhập Facebook/Instagram của bạn.')
    console.log('2. Xác minh 2FA hoặc mã bảo mật (nếu có).')
    console.log('3. Chọn đúng Trang Fanpage / Instagram của Shop (QuanNguyenS).')
    console.log('4. Khi màn hình Hộp thư tin nhắn hiện ra đầy đủ:')
    console.log('   👉 Quay lại đây và nhấn phím [ENTER] để lưu phiên đăng nhập.')
    console.log('------------------------------------------------------\n')

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    await new Promise((resolve) => rl.question('Nhấn [ENTER] khi bạn đã đăng nhập xong: ', resolve))
    rl.close()

    console.log('\n⏳ Đang kiểm tra trạng thái đăng nhập...')
    const loginStatus = await metaAgent.checkLoginStatus(page)
    console.log(`Kết quả: ${loginStatus.isLoggedIn ? '✅ ĐÃ ĐĂNG NHẬP THÀNH CÔNG!' : '⚠️ CHƯA NHẬN DIỆN ĐƯỢC'}`)
    console.log(`Chi tiết: ${loginStatus.reason}`)

    console.log('💾 Đang lưu Cookie, Tokens và Session State vào data/playwright_storage_state.json...')
    const savedPath = await browserManager.saveStorageState()
    console.log(`✅ Đã lưu phiên làm việc an toàn tại: ${savedPath}`)
    console.log('\n🎉 TẤT CẢ ĐÃ SẴN SÀNG! Giờ đây bạn có thể kích hoạt tự động hóa 24/7 bằng lệnh:')
    console.log('   npm run playwright:start\n')
  } catch (err) {
    console.error('❌ Lỗi trong quá trình đăng nhập:', err.message)
  } finally {
    await browserManager.close()
    process.exit(0)
  }
}

main()
