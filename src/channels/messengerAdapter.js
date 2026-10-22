import { config } from '../config/env.js'
import { canSendGate } from './canSend.js'
import { auditLogger } from '../security/auditLogger.js'

export class MessengerAdapter {
  constructor(pageAccessToken = config.META_PAGE_ACCESS_TOKEN) {
    this.token = pageAccessToken
    this.graphApiUrl = 'https://graph.facebook.com/v21.0/me/messages'
  }

  /**
   * Phân tích tin nhắn gửi đến từ Meta Webhook Payload
   */
  parseInboundEvent(messagingItem) {
    const senderId = messagingItem.sender?.id
    const recipientId = messagingItem.recipient?.id
    const timestamp = messagingItem.timestamp
    const message = messagingItem.message

    if (!message || message.is_echo) {
      return null // Bỏ qua echo hoặc delivery receipt
    }

    return {
      channel: 'messenger',
      channelSenderId: senderId,
      channelRecipientId: recipientId,
      messageId: message.mid,
      text: message.text || '',
      quickReplyPayload: message.quick_reply?.payload || null,
      attachments: message.attachments || [],
      occurredAt: new Date(timestamp).toISOString(),
    }
  }

  /**
   * Gửi tin nhắn qua Facebook Messenger Graph API
   */
  async sendMessage({
    recipientId,
    text,
    messageType = 'support',
    metaMessageTag = null,
    lastCustomerInteractionAt = null,
    fetchImpl = globalThis.fetch,
  }) {
    // 1. Kiểm tra Cổng can_send Runtime bắt buộc
    const canSendCheck = canSendGate.evaluate({
      customerId: recipientId,
      channel: 'messenger',
      messageType,
      metaMessageTag,
      lastCustomerInteractionAt,
    })

    if (canSendCheck.decision !== 'ALLOW') {
      console.warn(`⛔ [MESSENGER BLOCKED] can_send từ chối: ${canSendCheck.reasonCode} - ${canSendCheck.message}`)
      return {
        sent: false,
        decision: canSendCheck.decision,
        reason: canSendCheck.reasonCode,
        message: canSendCheck.message,
      }
    }

    // 2. Chuẩn bị payload chuẩn Meta Graph API v21.0
    const body = {
      recipient: { id: recipientId },
      message: { text },
      messaging_type: metaMessageTag ? 'MESSAGE_TAG' : 'RESPONSE',
    }

    if (metaMessageTag) {
      body.tag = metaMessageTag
    }

    if (!this.token) {
      if (config.NODE_ENV === 'production') {
        console.error(`🚨 [MESSENGER ERROR] META_PAGE_ACCESS_TOKEN chưa cấu hình trong môi trường Production. Không thể gửi tin nhắn.`)
        return {
          sent: false,
          error: 'META_PAGE_ACCESS_TOKEN not configured in production',
          errorCode: 'TOKEN_MISSING',
        }
      }
      console.warn(`⚠️ [MESSENGER MOCK] META_PAGE_ACCESS_TOKEN chưa cấu hình. Trả kết quả giả lập an toàn.`)
      return {
        sent: true,
        mock: true,
        providerMessageId: `mock_mid_${Date.now()}`,
      }
    }

    try {
      const response = await fetchImpl(this.graphApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify(body),
      })

      const data = await response.json()

      if (!response.ok) {
        console.error(`🚨 [MESSENGER API ERROR]:`, data)
        return {
          sent: false,
          error: data.error?.message || 'Meta API returned non-200',
          errorCode: data.error?.code,
        }
      }

      auditLogger.logAction({
        actorType: 'AI_AGENT',
        actorId: 'may',
        actionName: 'MESSENGER_MESSAGE_SENT',
        targetEntityType: 'customer',
        targetEntityId: recipientId,
        inputPayload: { text, metaMessageTag },
        resultStatus: 'SUCCEEDED',
        evidenceRef: data.message_id,
      })

      return {
        sent: true,
        providerMessageId: data.message_id,
      }
    } catch (err) {
      console.error(`🚨 [MESSENGER NETWORK ERROR]:`, err.message)
      return {
        sent: false,
        error: err.message,
      }
    }
  }
}

export const messengerAdapter = new MessengerAdapter()
