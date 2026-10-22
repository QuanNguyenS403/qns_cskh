import { config } from '../config/env.js'
import { eventGateway } from '../events/eventGateway.js'
import { messengerAdapter } from './messengerAdapter.js'
import { instagramAdapter } from './instagramAdapter.js'
import { threadsAdapter } from './threadsAdapter.js'

/**
 * META WEBHOOK HANDLER (Messenger, Instagram Direct, Threads)
 */

export function handleMetaWebhookGet(req, res) {
  const mode = req.query['hub.mode']
  const token = req.query['hub.verify_token']
  const challenge = req.query['hub.challenge']

  if (mode === 'subscribe' && token === config.META_VERIFY_TOKEN) {
    console.log('✅ [META WEBHOOK VERIFIED] Webhook xác minh thành công với Meta Platform!')
    return res.status(200).send(challenge)
  }

  console.warn('⛔ [META WEBHOOK REJECTED] Sai Verify Token từ Meta.')
  return res.status(403).send('Forbidden')
}

export async function handleMetaWebhookPost(req, res, orchestratorHandler = null) {
  const signature = req.headers['x-hub-signature-256']
  const rawBody = req.rawBody || JSON.stringify(req.body)

  // Nếu đã có META_APP_SECRET, bắt buộc kiểm tra chữ ký HMAC-SHA256
  if (config.META_APP_SECRET) {
    const isValid = eventGateway.verifySignature(rawBody, signature, config.META_APP_SECRET)
    if (!isValid) {
      console.warn('⛔ [META SIGNATURE FAILED] Sai chữ ký x-hub-signature-256!')
      return res.status(401).json({ success: false, error: 'Unauthorized signature' })
    }
  }

  const payload = req.body || {}
  const objectType = payload.object // page (Messenger) | instagram | threads

  // Trả về 200 OK ngay lập tức cho Meta để không bị timeout
  res.status(200).send('EVENT_RECEIVED')

  // Xử lý sự kiện không đồng bộ
  if (Array.isArray(payload.entry)) {
    for (const entry of payload.entry) {
      // 1. Messenger & Instagram messaging events
      if (Array.isArray(entry.messaging)) {
        for (const item of entry.messaging) {
          const isInstagram = objectType === 'instagram'
          const adapter = isInstagram ? instagramAdapter : messengerAdapter
          const inbound = adapter.parseInboundEvent(item)

          if (inbound && inbound.text) {
            // Chống trùng sự kiện bằng EventGateway
            const ingestRes = eventGateway.ingestEvent({
              eventId: inbound.messageId,
              source: inbound.channel,
              eventType: 'message.received',
              entityType: 'customer',
              entityId: inbound.channelSenderId,
              payload: inbound,
            })

            if (!ingestRes.isDuplicate && orchestratorHandler) {
              try {
                await orchestratorHandler(inbound)
              } catch (hErr) {
                console.error(`🚨 [ORCHESTRATOR ERROR]:`, hErr.message)
              }
            }
          }
        }
      }

      // 2. Threads events
      if (objectType === 'threads' && Array.isArray(entry.changes)) {
        for (const change of entry.changes) {
          if (change.field === 'threads') {
            const inbound = threadsAdapter.parseInboundEvent(change.value)
            if (inbound && orchestratorHandler) {
              const ingestRes = eventGateway.ingestEvent({
                eventId: inbound.channelConversationId || `threads_${Date.now()}`,
                source: 'threads',
                eventType: 'thread.mention',
                entityType: 'customer',
                entityId: inbound.channelSenderId,
                payload: inbound,
              })

              if (!ingestRes.isDuplicate) {
                await orchestratorHandler(inbound)
              }
            }
          }
        }
      }
    }
  }
}
