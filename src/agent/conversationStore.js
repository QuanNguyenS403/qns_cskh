import crypto from 'crypto'
import { config } from '../config/env.js'

/**
 * CONVERSATION & MESSAGE STORAGE MANAGER (Phase R1)
 * Quản lý phiên hội thoại bền vững (Durable Conversations) và lịch sử tin nhắn (Messages) trong SQLite.
 * Đảm bảo:
 * 1. Lưu trữ và nạp lịch sử đa lượt tin cậy qua các lần khởi động lại máy chủ.
 * 2. Phân định quyền sở hữu hội thoại (conversation_owner: BOT vs HUMAN).
 * 3. Hỗ trợ truy vấn ngữ cảnh gần nhất cho mô hình ngôn ngữ (LLM Context Window).
 */

export class ConversationStore {
  /**
   * Lấy hoặc khởi tạo phiên hội thoại bền vững cho khách hàng trên kênh
   */
  static getOrCreateConversation(db, {
    channel = 'web',
    channelSenderId = 'anonymous',
    tenantId = config.DEFAULT_TENANT_ID,
    shopId = config.DEFAULT_SHOP_ID,
    customerId = null,
  }) {
    if (!db) throw new Error('Database instance is required for ConversationStore')

    const cleanChannel = String(channel).toLowerCase()
    const cleanSenderId = String(channelSenderId)

    // 1. Tìm phiên hội thoại hiện có theo UNIQUE(channel, channel_conversation_id)
    const existing = db.prepare(`
      SELECT * FROM conversations
      WHERE channel = ? AND channel_conversation_id = ?
    `).get(cleanChannel, cleanSenderId)

    if (existing) {
      return existing
    }

    // 2. Tạo phiên mới nếu chưa tồn tại
    const now = new Date().toISOString()
    const conversationId = `conv_${cleanChannel}_${cleanSenderId}_${Date.now().toString(36)}`

    try {
      db.prepare(`
        INSERT INTO conversations (
          id, tenant_id, shop_id, channel, channel_conversation_id,
          customer_id, conversation_owner, status, last_interaction_at,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'BOT', 'ACTIVE', ?, ?, ?)
      `).run(
        conversationId,
        tenantId,
        shopId,
        cleanChannel,
        cleanSenderId,
        customerId,
        now,
        now,
        now
      )

      return db.prepare(`SELECT * FROM conversations WHERE id = ?`).get(conversationId)
    } catch (err) {
      // Trường hợp race condition: đọc lại
      const raceRow = db.prepare(`
        SELECT * FROM conversations
        WHERE channel = ? AND channel_conversation_id = ?
      `).get(cleanChannel, cleanSenderId)
      if (raceRow) return raceRow
      throw err
    }
  }

  /**
   * Lưu một tin nhắn (Inbound hoặc Outbound) vào bảng messages
   */
  static saveMessage(db, {
    conversationId,
    senderType = 'CUSTOMER', // CUSTOMER | BOT | HUMAN | SYSTEM
    senderId = null,
    contentText = '',
    payloadJson = null,
    direction = 'INBOUND', // INBOUND | OUTBOUND
    providerMessageId = null,
    createdAt = new Date().toISOString(),
  }) {
    if (!db) throw new Error('Database instance is required')
    if (!conversationId) throw new Error('conversationId is required to save message')

    const messageId = `msg_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`
    const payloadStr = payloadJson ? (typeof payloadJson === 'string' ? payloadJson : JSON.stringify(payloadJson)) : null

    db.prepare(`
      INSERT INTO messages (
        id, conversation_id, sender_type, sender_id,
        content_text, payload_json, direction, provider_message_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      messageId,
      conversationId,
      senderType,
      senderId ? String(senderId) : null,
      String(contentText || ''),
      payloadStr,
      direction,
      providerMessageId ? String(providerMessageId) : null,
      createdAt
    )

    // Cập nhật mốc tương tác gần nhất trong bảng conversations
    db.prepare(`
      UPDATE conversations
      SET last_interaction_at = ?, updated_at = ?
      WHERE id = ?
    `).run(createdAt, createdAt, conversationId)

    return {
      id: messageId,
      conversationId,
      senderType,
      contentText,
      direction,
      createdAt,
    }
  }

  /**
   * Lấy lịch sử hội thoại gần nhất để cung cấp ngữ cảnh cho May AI (LLM / Logic)
   */
  static getRecentMessages(db, conversationId, limit = 20) {
    if (!db || !conversationId) return []

    const rows = db.prepare(`
      SELECT id, conversation_id, sender_type, sender_id, content_text,
             payload_json, direction, provider_message_id, created_at
      FROM messages
      WHERE conversation_id = ?
      ORDER BY created_at ASC
    `).all(conversationId)

    // Lấy tối đa limit tin nhắn gần nhất
    const trimmed = rows.slice(-limit)

    return trimmed.map((row) => ({
      id: row.id,
      role: row.sender_type === 'CUSTOMER' ? 'user' : (row.sender_type === 'BOT' ? 'model' : 'assistant'),
      senderType: row.sender_type,
      senderId: row.sender_id,
      text: row.content_text,
      direction: row.direction,
      providerMessageId: row.provider_message_id,
      createdAt: row.created_at,
    }))
  }

  /**
   * Cập nhật quyền sở hữu phiên hội thoại (Chuyển giao cho Nhân viên / Handoff)
   */
  static setConversationOwner(db, conversationId, owner = 'BOT', reason = '') {
    if (!db || !conversationId) return null
    const validOwner = owner === 'HUMAN' ? 'HUMAN' : 'BOT'
    const now = new Date().toISOString()

    db.prepare(`
      UPDATE conversations
      SET conversation_owner = ?, updated_at = ?
      WHERE id = ?
    `).run(validOwner, now, conversationId)

    return { conversationId, conversationOwner: validOwner, reason, updatedAt: now }
  }

  /**
   * Kiểm tra xem phiên hội thoại có đang do con người (Chủ shop/CSKH) tiếp quản không
   */
  static isHumanControlled(db, conversationId) {
    if (!db || !conversationId) return false
    const conv = db.prepare(`SELECT conversation_owner FROM conversations WHERE id = ?`).get(conversationId)
    return conv && conv.conversation_owner === 'HUMAN'
  }
}
