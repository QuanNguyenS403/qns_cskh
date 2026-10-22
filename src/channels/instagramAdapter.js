import { config } from '../config/env.js'
import { canSendGate } from './canSend.js'
import { auditLogger } from '../security/auditLogger.js'

export class InstagramAdapter {
  constructor(accessToken = config.INSTAGRAM_ACCESS_TOKEN || config.META_PAGE_ACCESS_TOKEN) {
    this.token = accessToken
    this.graphApiUrl = 'https://graph.facebook.com/v21.0/me/messages'
  }

  parseInboundEvent(messagingItem) {
    const senderId = messagingItem.sender?.id
    const recipientId = messagingItem.recipient?.id
    const timestamp = messagingItem.timestamp
    const message = messagingItem.message

    if (!message || message.is_echo) {
      return null
    }

    return {
      channel: 'instagram',
      channelSenderId: senderId,
      channelRecipientId: recipientId,
      messageId: message.mid,
      text: message.text || '',
      attachments: message.attachments || [],
      occurredAt: new Date(timestamp).toISOString(),
    }
  }

  async sendMessage({
    recipientId,
    text,
    messageType = 'support',
    lastCustomerInteractionAt = null,
    fetchImpl = globalThis.fetch,
  }) {
    // 1. Kiểm tra Cổng can_send Runtime (Instagram không mượn quy tắc Messenger Tag ngoài 24h - B12)
    const canSendCheck = canSendGate.evaluate({
      customerId: recipientId,
      channel: 'instagram',
      messageType,
      metaMessageTag: null, // Instagram không hỗ trợ Message Tags ngoài 24h cho bot
      lastCustomerInteractionAt,
    })

    if (canSendCheck.decision !== 'ALLOW') {
      console.warn(`⛔ [INSTAGRAM BLOCKED] can_send từ chối: ${canSendCheck.reasonCode} - ${canSendCheck.message}`)
      return {
        sent: false,
        decision: canSendCheck.decision,
        reason: canSendCheck.reasonCode,
        message: canSendCheck.message,
      }
    }

    const body = {
      recipient: { id: recipientId },
      message: { text },
    }

    if (!this.token) {
      if (config.NODE_ENV === 'production') {
        console.error(`🚨 [INSTAGRAM ERROR] INSTAGRAM_ACCESS_TOKEN chưa cấu hình trong môi trường Production. Không thể gửi tin nhắn.`)
        return {
          sent: false,
          error: 'INSTAGRAM_ACCESS_TOKEN not configured in production',
          errorCode: 'TOKEN_MISSING',
        }
      }
      console.warn(`⚠️ [INSTAGRAM MOCK] INSTAGRAM_ACCESS_TOKEN chưa cấu hình. Trả kết quả giả lập an toàn.`)
      return {
        sent: true,
        mock: true,
        providerMessageId: `mock_ig_mid_${Date.now()}`,
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
        console.error(`🚨 [INSTAGRAM API ERROR]:`, data)
        return {
          sent: false,
          error: data.error?.message || 'Instagram API error',
          errorCode: data.error?.code,
        }
      }

      auditLogger.logAction({
        actorType: 'AI_AGENT',
        actorId: 'may',
        actionName: 'INSTAGRAM_MESSAGE_SENT',
        targetEntityType: 'customer',
        targetEntityId: recipientId,
        inputPayload: { text },
        resultStatus: 'SUCCEEDED',
        evidenceRef: data.message_id,
      })

      return {
        sent: true,
        providerMessageId: data.message_id,
      }
    } catch (err) {
      console.error(`🚨 [INSTAGRAM NETWORK ERROR]:`, err.message)
      return { sent: false, error: err.message }
    }
  }
}

export const instagramAdapter = new InstagramAdapter()
