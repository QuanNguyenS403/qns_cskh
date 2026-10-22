import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import { DatabaseSync } from 'node:sqlite'
import { runMigrations } from '../../src/db/migrations.js'
import { seedDefaultPolicies } from '../../src/policies/policyRegistry.js'
import { MayOrchestrator } from '../../src/agent/mayOrchestrator.js'
import { ConversationStore } from '../../src/agent/conversationStore.js'
import { EventGateway } from '../../src/events/eventGateway.js'

test('Phase R1 - Inbox Queue & Durable Conversation Storage Integration', async (t) => {
  const testDbPath = path.resolve('data/test_r1_storage.db')
  fs.mkdirSync(path.dirname(testDbPath), { recursive: true })
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath)
  }

  const db = new DatabaseSync(testDbPath)
  runMigrations(db)
  seedDefaultPolicies(db, 'quannguyens_pijama', true)

  const customerId = 'cust_meta_987654321'
  const channel = 'messenger'

  // ----------------------------------------------------
  // Gate 1: Tự động khởi tạo Conversation & lưu Message Inbound
  // ----------------------------------------------------
  await t.test('1. Inbound message tự động tạo conversation và lưu message vào SQLite', async () => {
    const orchestrator = new MayOrchestrator(db)
    const inboundText = 'Shop ơi cho mình xin thông tin chuyển khoản Vietcombank với ạ'
    const providerMid = 'mid.1792660001'

    const res = await orchestrator.processMessage({
      text: inboundText,
      channel,
      senderId: customerId,
      providerMessageId: providerMid,
    })

    assert.ok(res.conversation_id, 'Phải có conversation_id trả về')
    assert.ok(res.customer_message, 'Bot phải phản hồi thông tin tài khoản')

    // Kiểm tra bảng conversations
    const convRow = db.prepare(`SELECT * FROM conversations WHERE id = ?`).get(res.conversation_id)
    assert.ok(convRow, 'Hội thoại phải tồn tại trong bảng conversations')
    assert.strictEqual(convRow.channel, channel)
    assert.strictEqual(convRow.channel_conversation_id, customerId)
    assert.strictEqual(convRow.conversation_owner, 'BOT')
    assert.strictEqual(convRow.status, 'ACTIVE')

    // Kiểm tra bảng messages (phải có đủ 2 tin: INBOUND từ khách và OUTBOUND từ bot)
    const messages = db.prepare(`SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC`).all(res.conversation_id)
    assert.strictEqual(messages.length, 2, 'Phải có đúng 2 tin nhắn trong bảng messages')

    // Tin 1: Khách gửi đến
    assert.strictEqual(messages[0].direction, 'INBOUND')
    assert.strictEqual(messages[0].sender_type, 'CUSTOMER')
    assert.strictEqual(messages[0].sender_id, customerId)
    assert.strictEqual(messages[0].content_text, inboundText)
    assert.strictEqual(messages[0].provider_message_id, providerMid)

    // Tin 2: Bot trả lời
    assert.strictEqual(messages[1].direction, 'OUTBOUND')
    assert.strictEqual(messages[1].sender_type, 'BOT')
    assert.strictEqual(messages[1].sender_id, 'quannguyens')
    assert.strictEqual(messages[1].content_text, res.customer_message)
  })

  // ----------------------------------------------------
  // Gate 2: Lượt trò chuyện tiếp theo sử dụng đúng phiên hội thoại
  // ----------------------------------------------------
  await t.test('2. Multi-turn conversation tái sử dụng conversationId và cập nhật mốc tương tác', async () => {
    // Khởi tạo một orchestrator mới (mô phỏng request mới sau process restart)
    const freshOrchestrator = new MayOrchestrator(db)
    const turn2Text = 'Bạn là người hay bot vậy?'
    const turn2Mid = 'mid.1792660002'

    const res2 = await freshOrchestrator.processMessage({
      text: turn2Text,
      channel,
      senderId: customerId,
      providerMessageId: turn2Mid,
    })

    assert.ok(res2.customer_message.includes('QuanNguyenS'))

    // Xác nhận không tạo thêm conversation mới
    const allConvs = db.prepare(`SELECT * FROM conversations WHERE channel = ? AND channel_conversation_id = ?`).all(channel, customerId)
    assert.strictEqual(allConvs.length, 1, 'Chỉ duy nhất 1 bản ghi conversation cho cùng 1 khách hàng trên 1 kênh')

    // Kiểm tra tổng số tin nhắn là 4
    const convId = allConvs[0].id
    const messages = db.prepare(`SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC`).all(convId)
    assert.strictEqual(messages.length, 4, 'Phải có 4 tin nhắn (2 lượt hỏi - đáp)')

    // Nạp lịch sử qua ConversationStore
    const history = ConversationStore.getRecentMessages(db, convId, 10)
    assert.strictEqual(history.length, 4)
    assert.strictEqual(history[0].role, 'user')
    assert.strictEqual(history[1].role, 'model')
    assert.strictEqual(history[2].role, 'user')
    assert.strictEqual(history[3].role, 'model')
  })

  // ----------------------------------------------------
  // Gate 3: Idempotent Webhook Message Ingestion (Chống trùng lặp tin)
  // ----------------------------------------------------
  await t.test('3. Duplicate webhook message payload có cùng messageId bị bỏ qua (Gate H13)', async () => {
    const gateway = new EventGateway(db)
    const duplicateMid = 'mid.unique_test_12345'
    const payload = { channel, senderId: customerId, text: 'Alo shop' }

    // Lần 1: Tiếp nhận
    const res1 = gateway.ingestEvent({
      eventId: duplicateMid,
      source: channel,
      eventType: 'message.received',
      entityType: 'customer',
      entityId: customerId,
      payload,
    })
    assert.strictEqual(res1.isDuplicate, false)
    assert.strictEqual(res1.status, 'ACCEPTED')

    // Lần 2: Meta gửi lại do mạng chậm -> Phải phát hiện trùng lặp
    const res2 = gateway.ingestEvent({
      eventId: duplicateMid,
      source: channel,
      eventType: 'message.received',
      entityType: 'customer',
      entityId: customerId,
      payload,
    })
    assert.strictEqual(res2.isDuplicate, true)
    assert.strictEqual(res2.status, 'DUPLICATE_IGNORED')
  })

  // ----------------------------------------------------
  // Gate 4: Chuyển giao quyền kiểm soát (Handoff) và Chặn Bot can thiệp khi HUMAN sở hữu
  // ----------------------------------------------------
  await t.test('4. Handoff P0/P1 chuyển quyền cho HUMAN, Bot chặn tự động trả lời khi nhân viên đang hỗ trợ', async () => {
    const angryCustomerId = 'cust_angry_99999'
    const orchestrator = new MayOrchestrator(db)

    // Khách gửi tin giận dữ, dọa bóc phốt (X07 / P1 handoff)
    const angryText = 'SHOP LỪA ĐẢO À? TÔI SẼ BÓC PHỐT VÀ ĐĂNG REVIEW XẤU LÊN CÁC HỘI NHÓM NẾU KHÔNG ĐỀN TIỀN NGAY!'
    const angryMid = 'mid.angry_001'

    const res = await orchestrator.processMessage({
      text: angryText,
      channel,
      senderId: angryCustomerId,
      providerMessageId: angryMid,
    })

    assert.strictEqual(res.handoff.required, true)
    assert.ok(res.handoff.priority === 'P0' || res.handoff.priority === 'P1')

    // Xác nhận conversation_owner đã tự động chuyển sang HUMAN
    const convRow = db.prepare(`SELECT * FROM conversations WHERE id = ?`).get(res.conversation_id)
    assert.strictEqual(convRow.conversation_owner, 'HUMAN', 'Phiên hội thoại phải được chuyển quyền cho HUMAN khi có Handoff khẩn cấp')

    // Lượt tiếp theo: Khách nhắn thêm tin
    const nextText = 'Có ai ở đó không?'
    const nextMid = 'mid.angry_002'

    const resFollowup = await orchestrator.processMessage({
      text: nextText,
      channel,
      senderId: angryCustomerId,
      providerMessageId: nextMid,
    })

    // Bot phải BỊ CHẶN (suppressed) không được tự ý trả lời
    assert.strictEqual(resFollowup.suppressed, true)
    assert.strictEqual(resFollowup.customer_message, null)
    assert.strictEqual(resFollowup.reason, 'CONVERSATION_OWNED_BY_HUMAN')

    // Nhưng tin nhắn vẫn được lưu vào bảng messages để nhân viên đọc
    const followUpMsg = db.prepare(`SELECT * FROM messages WHERE provider_message_id = ?`).get(nextMid)
    assert.ok(followUpMsg, 'Tin nhắn của khách vẫn phải được lưu vào CSDL để nhân viên xử lý')
    assert.strictEqual(followUpMsg.content_text, nextText)
  })

  // ----------------------------------------------------
  // Gate 5: Chủ shop trả lại quyền cho Bot (Admin Resume)
  // ----------------------------------------------------
  await t.test('5. Chủ shop / CSKH có thể trả quyền điều khiển lại cho Bot', async () => {
    const customer = 'cust_angry_99999'
    const conv = db.prepare(`SELECT id FROM conversations WHERE channel_conversation_id = ?`).get(customer)
    assert.ok(conv)

    // Admin resume quyền cho Bot
    ConversationStore.setConversationOwner(db, conv.id, 'BOT', 'Admin resolved case')
    assert.strictEqual(ConversationStore.isHumanControlled(db, conv.id), false)

    // Khách nhắn tin lại -> Bot phản hồi bình thường
    const orchestrator = new MayOrchestrator(db)
    const res = await orchestrator.processMessage({
      text: 'shop oi set nay ib gia vs size m ko',
      channel,
      senderId: customer,
    })

    assert.strictEqual(res.suppressed, undefined)
    assert.ok(res.customer_message)
  })
})
