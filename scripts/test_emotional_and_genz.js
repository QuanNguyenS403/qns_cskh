import { getDb } from '../src/db/connection.js'
import { MayOrchestrator } from '../src/agent/mayOrchestrator.js'

async function testEmotionalAndGenZ() {
  const db = getDb()
  const orchestrator = new MayOrchestrator(db)

  const scenarios = [
    {
      title: 'Kịch bản 1: Khách dùng tiếng lóng Gen Z, teen code, viết tắt',
      text: 'sop oi set pijama soc hong nay ib gia vs sz m ko, e m55 48kg mac vua in k sop',
      senderId: 'genz_kh_01',
    },
    {
      title: 'Kịch bản 2: Khách hỏi chất liệu & thắc mắc chất vải lụa',
      text: 'Shop có bán pijama lụa không bạn ơi, chất vải sờ có mát và giặt có nhăn không?',
      senderId: 'material_kh_02',
    },
    {
      title: 'Kịch bản 3: Khách tâm sự đời sống, cảm xúc buồn (Ngoài lề)',
      text: 'Nay em thi trượt buồn quá shop ơi :(',
      senderId: 'emotion_kh_03',
    },
    {
      title: 'Kịch bản 4: Khách hỏi tư vấn thời tiết & vibe thư giãn (Vừa ngoài lề vừa pijama)',
      text: 'Nay trời mưa lạnh nằm nhà mặc set nào chill hả shop',
      senderId: 'weather_kh_04',
    },
    {
      title: 'Kịch bản 5: Khách hỏi tư vấn chọn giữa 2 mẫu',
      text: 'Giữa set Daybreak với Stillwater thì set nào mặc ngủ mùa thu hợp hơn hả bạn?',
      senderId: 'compare_kh_05',
    },
  ]

  console.log('======================================================================')
  console.log('🧪 KIỂM THỬ THỰC TẾ: ĐỘ THẤU CẢM, CẢM XÚC & GIẢI MÃ GEN Z CỦA QUANNGUYENS')
  console.log('======================================================================\n')

  for (const sc of scenarios) {
    console.log(`\n----------------------------------------------------------------------`)
    console.log(`📌 ${sc.title}`)
    console.log(`💬 Khách nhắn: "${sc.text}"`)
    const start = Date.now()
    try {
      const response = await orchestrator.processMessage({
        text: sc.text,
        channel: 'messenger',
        senderId: sc.senderId,
      })
      const elapsed = Date.now() - start
      console.log(`⏱️ Thời gian phản hồi: ${elapsed}ms`)
      console.log(`🤖 QuanNguyenS phản hồi:\n${response.customer_message}`)
      console.log(`🏷️ Intent codes: [${response.intent_codes.join(', ')}]`)
      console.log(`🧭 Next step: ${response.next_step}`)
    } catch (err) {
      console.error(`❌ Lỗi kịch bản:`, err.message)
    }
  }

  console.log('\n======================================================================')
  console.log('🏁 HOÀN TẤT KIỂM THỬ THỰC TẾ')
  console.log('======================================================================')
}

testEmotionalAndGenZ().catch(console.error)
