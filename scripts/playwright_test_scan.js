import { BrowserManager } from '../src/automation/browserManager.js'
import { MetaBusinessSuiteAgent } from '../src/automation/metaBusinessSuiteAgent.js'

/**
 * Script kiểm thử quét Hộp thư và Thử nghiệm sinh câu trả lời AI (Dry-Run: KHÔNG GỬI THẬT)
 */
async function testScan() {
  console.log('\n======================================================')
  console.log('🧪 QUANNGUYENS PLAYWRIGHT DRY-RUN TEST SCAN')
  console.log('   Quét hộp thư & thử sinh câu trả lời AI (Không gửi thật)')
  console.log('======================================================\n')

  const browserManager = new BrowserManager({ headless: true })
  const metaAgent = new MetaBusinessSuiteAgent()

  try {
    console.log('🌐 Đang khởi động trình duyệt...')
    await browserManager.init()
    const page = await browserManager.getPage()

    console.log('👉 Đang điều hướng đến Meta Business Suite...')
    await metaAgent.navigateToInbox(page)

    const loginCheck = await metaAgent.checkLoginStatus(page)
    console.log(`\nURL hiện tại: ${page.url()}`)
    console.log(`Trạng thái đăng nhập: ${loginCheck.isLoggedIn ? '✅ ĐÃ ĐĂNG NHẬP' : '⚠️ CHƯA ĐĂNG NHẬP'}`)
    console.log(`Chi tiết: ${loginCheck.reason}\n`)

    if (!loginCheck.isLoggedIn) {
      console.log('ℹ️ Gợi ý: Hãy chạy "npm run playwright:login" để đăng nhập trước khi chạy tự động.')
      return
    }

    console.log('🔍 Đang phân tích cuộc hội thoại hiện tại...')
    const result = await metaAgent.processCurrentConversation(page, { dryRun: true })

    console.log('\n📊 KẾT QUẢ QUÉT:')
    console.log(JSON.stringify(result, null, 2))
  } catch (err) {
    console.error('❌ Lỗi kiểm thử:', err.message)
  } finally {
    await browserManager.close()
    console.log('\n🏁 Hoàn thành kiểm thử.')
    process.exit(0)
  }
}

testScan()
