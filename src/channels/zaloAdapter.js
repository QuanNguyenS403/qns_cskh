import { config } from '../config/env.js'
import { canSendGate } from './canSend.js'
import { auditLogger } from '../security/auditLogger.js'

export class ZaloAdapter {
  constructor(accessToken = config.ZALO_ACCESS_TOKEN) {
    this.token = accessToken
    this.zaloApiUrl = 'https://openapi.zalo.me/v3.0/oa/message'
  }

  parseInboundEvent(body) {
    const eventName = body.event_name
    const sender = body.sender?.id
    const recipient = body.recipient?.id
    const message = body.message

    if (eventName !== 'user_send_text') {
      return null
    }

    return {
      channel: 'zalo',
      channelSenderId: sender,
      channelRecipientId: recipient,
      messageId: message?.msg_id || `zalo_msg_${Date.now()}`,
      text: message?.text || '',
      occurredAt: new Date(body.timestamp || Date.now()).toISOString(),
    }
  }

  /**
   * Gửi tin nhắn văn bản tư vấn CSKH qua Zalo OA (OpenAPI v3.0 / CS)
   */
  async sendTextMessage({
    recipientId,
    text,
    fetchImpl = globalThis.fetch,
  }) {
    const canSendCheck = canSendGate.evaluate({
      customerId: recipientId,
      channel: 'zalo',
      messageType: 'support',
    })

    if (canSendCheck.decision !== 'ALLOW') {
      return { sent: false, reason: canSendCheck.reasonCode, message: canSendCheck.message }
    }

    if (!this.token) {
      console.warn(`⚠️ [ZALO MOCK] ZALO_ACCESS_TOKEN chưa cấu hình. Trả kết quả giả lập an toàn.`)
      return {
        sent: true,
        mock: true,
        msgId: `mock_zalo_${Date.now()}`,
      }
    }

    try {
      const response = await fetchImpl(`${this.zaloApiUrl}/cs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          access_token: this.token,
        },
        body: JSON.stringify({
          recipient: { user_id: recipientId },
          message: { text },
        }),
      })

      const data = await response.json()
      if (data.error !== 0) {
        return { sent: false, error: data.message, errorCode: data.error }
      }

      auditLogger.logAction({
        actorType: 'AI_AGENT',
        actorId: 'may',
        actionName: 'ZALO_MESSAGE_SENT',
        targetEntityType: 'customer',
        targetEntityId: recipientId,
        inputPayload: { text },
        resultStatus: 'SUCCEEDED',
        evidenceRef: data.data?.msg_id,
      })

      return { sent: true, msgId: data.data?.msg_id }
    } catch (err) {
      console.error(`🚨 [ZALO NETWORK ERROR]:`, err.message)
      return { sent: false, error: err.message }
    }
  }

  async sendTemplateMessage({
    recipientId,
    templateId,
    templateData,
    fetchImpl = globalThis.fetch,
  }) {
    const canSendCheck = canSendGate.evaluate({
      customerId: recipientId,
      channel: 'zalo',
      messageType: 'transactional',
    })

    if (canSendCheck.decision !== 'ALLOW') {
      return { sent: false, reason: canSendCheck.reasonCode, message: canSendCheck.message }
    }

    if (!this.token) {
      console.warn(`⚠️ [ZALO MOCK] ZALO_ACCESS_TOKEN chưa cấu hình. Trả kết quả giả lập an toàn.`)
      return {
        sent: true,
        mock: true,
        msgId: `mock_zalo_${Date.now()}`,
      }
    }

    try {
      const response = await fetchImpl(`${this.zaloApiUrl}/template`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          access_token: this.token,
        },
        body: JSON.stringify({
          recipient: { user_id: recipientId },
          template_id: templateId,
          template_data: templateData,
        }),
      })

      const data = await response.json()
      if (data.error !== 0) {
        return { sent: false, error: data.message, errorCode: data.error }
      }

      auditLogger.logAction({
        actorType: 'AI_AGENT',
        actorId: 'may',
        actionName: 'ZALO_TEMPLATE_SENT',
        targetEntityType: 'customer',
        targetEntityId: recipientId,
        inputPayload: { templateId, templateData },
        resultStatus: 'SUCCEEDED',
        evidenceRef: data.data?.msg_id,
      })

      return { sent: true, msgId: data.data?.msg_id }
    } catch (err) {
      console.error(`🚨 [ZALO NETWORK ERROR]:`, err.message)
      return { sent: false, error: err.message }
    }
  }
}

export const zaloAdapter = new ZaloAdapter()
