import { config } from '../config/env.js'
import { canSendGate } from './canSend.js'
import { auditLogger } from '../security/auditLogger.js'

export class ThreadsAdapter {
  constructor(accessToken = config.THREADS_ACCESS_TOKEN, userId = config.THREADS_USER_ID) {
    this.token = accessToken
    this.userId = userId
    this.threadsApiUrl = 'https://graph.threads.net/v1.0'
  }

  /**
   * Phân tích sự kiện mention / reply từ Threads Webhook
   */
  parseInboundEvent(eventItem) {
    const threadId = eventItem.thread_id || eventItem.id
    const text = eventItem.text || ''
    const authorId = eventItem.author_id || eventItem.sender_id
    const timestamp = eventItem.timestamp || Date.now()

    return {
      channel: 'threads',
      channelSenderId: authorId,
      channelConversationId: threadId,
      text,
      occurredAt: new Date(timestamp).toISOString(),
    }
  }

  /**
   * Trả lời (Reply) một bài viết hoặc thread của khách hàng trên Threads
   */
  async replyToThread({
    replyToThreadId,
    text,
    fetchImpl = globalThis.fetch,
  }) {
    const canSendCheck = canSendGate.evaluate({
      customerId: replyToThreadId,
      channel: 'threads',
      messageType: 'support',
    })

    if (canSendCheck.decision !== 'ALLOW') {
      return { sent: false, reason: canSendCheck.reasonCode, message: canSendCheck.message }
    }

    if (!this.token || !this.userId) {
      console.warn(`⚠️ [THREADS MOCK] THREADS_ACCESS_TOKEN hoặc THREADS_USER_ID chưa cấu hình. Trả kết quả giả lập an toàn.`)
      return {
        sent: true,
        mock: true,
        publishedId: `mock_threads_${Date.now()}`,
      }
    }

    try {
      // Bước 1: Tạo Container cho Reply
      const containerRes = await fetchImpl(`${this.threadsApiUrl}/${this.userId}/threads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          media_type: 'TEXT',
          text,
          reply_to_id: replyToThreadId,
          access_token: this.token,
        }),
      })

      const containerData = await containerRes.json()
      if (!containerRes.ok || !containerData.id) {
        return { sent: false, error: containerData.error?.message || 'Lỗi tạo Threads Container' }
      }

      // Bước 2: Xuất bản Container
      const publishRes = await fetchImpl(`${this.threadsApiUrl}/${this.userId}/threads_publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creation_id: containerData.id,
          access_token: this.token,
        }),
      })

      const publishData = await publishRes.json()

      auditLogger.logAction({
        actorType: 'AI_AGENT',
        actorId: 'quannguyens',
        actionName: 'THREADS_REPLY_PUBLISHED',
        targetEntityType: 'thread',
        targetEntityId: replyToThreadId,
        inputPayload: { text },
        resultStatus: 'SUCCEEDED',
        evidenceRef: publishData.id,
      })

      return {
        sent: true,
        publishedId: publishData.id,
      }
    } catch (err) {
      console.error(`🚨 [THREADS NETWORK ERROR]:`, err.message)
      return { sent: false, error: err.message }
    }
  }
}

export const threadsAdapter = new ThreadsAdapter()
