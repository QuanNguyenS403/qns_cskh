import crypto from 'node:crypto'
import { config } from '../config/env.js'
import { killSwitch } from '../config/killSwitch.js'
import { alertNotifier } from '../security/alertNotifier.js'
import { MayOrchestrator } from '../agent/mayOrchestrator.js'
import { getDb } from '../db/connection.js'

/**
 * CLOUD BRIDGE ADAPTER (Botcake / AhaChat / Fchat / ManyChat -> Render Cloud 24/7)
 *
 * Cho phép kết nối Fanpage Messenger & Instagram Direct thông qua các nền tảng
 * Meta Official Tech Provider miễn phí (Botcake.io, AhaChat, ManyChat...) trỏ thẳng
 * về máy chủ Render Cloud (https://cskh-2m9m.onrender.com) — hoạt động 24/7 kể cả
 * khi tắt hẳn nguồn laptop và không cần tự Xác minh doanh nghiệp với Meta.
 */

const VIETQR_URL_REGEX = /https:\/\/img\.vietqr\.io\/image\/[^\s)"'<>]+/i

/**
 * Tách tin nhắn dài thành các bong bóng < 1850 ký tự (giới hạn 2000 ký tự của Meta Messenger/Instagram)
 */
export function splitIntoMessageBubbles(text, maxLen = 1850) {
  const clean = String(text || '').trim()
  if (!clean) return []
  if (clean.length <= maxLen) return [clean]

  const bubbles = []
  let remaining = clean
  while (remaining.length > maxLen) {
    let splitIdx = remaining.lastIndexOf('\n\n', maxLen)
    if (splitIdx <= 0) {
      splitIdx = remaining.lastIndexOf('\n', maxLen)
    }
    if (splitIdx <= 0) {
      splitIdx = remaining.lastIndexOf('. ', maxLen)
      if (splitIdx > 0) splitIdx += 1
    }
    if (splitIdx <= 0) {
      splitIdx = remaining.lastIndexOf(' ', maxLen)
    }
    if (splitIdx <= 0) {
      splitIdx = maxLen
    }
    bubbles.push(remaining.slice(0, splitIdx).trim())
    remaining = remaining.slice(splitIdx).trim()
  }
  if (remaining) bubbles.push(remaining)
  return bubbles
}

/**
 * Chuẩn hóa dữ liệu đầu vào linh hoạt từ Botcake, AhaChat, Fchat, SmaxAI, ManyChat (hỗ trợ cả POST JSON & GET Query)
 */
export function extractCloudBridgeInput(req, defaultPlatform = 'auto') {
  const body = req.body && typeof req.body === 'object' ? req.body : {}
  const query = req.query && typeof req.query === 'object' ? req.query : {}
  const sub = body.subscriber || body.customer || body.user || body.data || {}

  // 1. Nội dung tin nhắn khách gửi
  const rawText =
    body.message ??
    body.text ??
    body.last_input_text ??
    body.last_user_freeform_input ??
    body.user_input ??
    body.content ??
    body.query ??
    sub.last_input_text ??
    sub.last_message ??
    sub.text ??
    query.message ??
    query.text ??
    query.last_input_text ??
    query.q ??
    ''

  // 2. ID định danh khách hàng trên kênh
  const fallbackIpId = crypto
    .createHash('sha1')
    .update(String(req.ip || req.headers['x-forwarded-for'] || 'guest'))
    .digest('hex')
    .slice(0, 12)

  const rawSenderId =
    body.senderId ??
    body.sender_id ??
    body.psid ??
    body.subscriber_id ??
    body.user_id ??
    body.customer_id ??
    body.id ??
    sub.id ??
    sub.psid ??
    sub.subscriber_id ??
    query.senderId ??
    query.sender_id ??
    query.psid ??
    query.subscriber_id ??
    query.id ??
    `cloud_${fallbackIpId}`

  // 3. Tên hiển thị của khách hàng
  const combinedFirstLast = [body.first_name || sub.first_name, body.last_name || sub.last_name]
    .filter(Boolean)
    .join(' ')
    .trim()

  const rawName =
    body.customerName ??
    body.customer_name ??
    body.full_name ??
    body.name ??
    (combinedFirstLast || null) ??
    sub.full_name ??
    sub.name ??
    query.customerName ??
    query.customer_name ??
    query.full_name ??
    query.name ??
    null

  // 4. Kênh nguồn (Messenger vs Instagram vs Zalo)
  const rawChannel = String(
    body.channel ?? body.platform ?? body.source ?? sub.channel ?? sub.platform ?? query.channel ?? query.platform ?? 'messenger'
  )
    .trim()
    .toLowerCase()

  let channel = 'messenger'
  if (rawChannel.includes('insta') || rawChannel === 'ig') {
    channel = 'instagram'
  } else if (rawChannel.includes('zalo')) {
    channel = 'zalo'
  } else if (rawChannel.includes('thread')) {
    channel = 'threads'
  }

  // 5. Định dạng phản hồi đầu ra ('botcake' | 'ahachat' | 'manychat' | 'universal')
  const requestedFormat = String(query.format || body.format || defaultPlatform || 'universal')
    .trim()
    .toLowerCase()

  return {
    text: String(rawText || '').trim(),
    senderId: String(rawSenderId).trim(),
    customerName: rawName ? String(rawName).trim() : null,
    channel,
    format: requestedFormat,
  }
}

/**
 * Đóng gói phản hồi theo đúng chuẩn JSON của Botcake / AhaChat / ManyChat
 * Lưu ý: Luôn trả về HTTP 200 OK để không bao giờ làm treo luồng chatbot trung gian.
 */
export function formatCloudBridgeResponse({ replyText, format = 'universal', agentResponse = null }) {
  if (!replyText) {
    if (format === 'manychat') {
      return { version: 'v2', content: { messages: [] } }
    }
    return {
      success: true,
      suppressed: true,
      reply_text: '',
      customer_message: '',
      messages: [],
      version: 'v2',
      content: { messages: [] },
    }
  }

  const textBubbles = splitIntoMessageBubbles(replyText)
  const qrMatch = replyText.match(VIETQR_URL_REGEX)
  const qrImageUrl = qrMatch ? qrMatch[0] : null

  // Mảng messages chuẩn Botcake / AhaChat / Fchat / Chatfuel
  const standardMessages = textBubbles.map((t) => ({ text: t }))
  if (qrImageUrl) {
    standardMessages.push({
      attachment: {
        type: 'image',
        payload: { url: qrImageUrl, is_reusable: true },
      },
    })
  }

  // Mảng messages chuẩn ManyChat Dynamic Block v2
  const manychatMessages = textBubbles.map((t) => ({ type: 'text', text: t }))
  if (qrImageUrl) {
    manychatMessages.push({ type: 'image', url: qrImageUrl })
  }

  if (format === 'manychat') {
    return {
      version: 'v2',
      content: {
        messages: manychatMessages,
      },
    }
  }

  if (format === 'ahachat') {
    return {
      messages: standardMessages,
    }
  }

  // Mặc định (Botcake & Universal): Tương thích đồng thời cả JSON API block (đọc `messages`)
  // lẫn HTTP Request gán biến Custom Field (`reply_text`, `ai_reply`, `customer_message`)
  return {
    success: true,
    messages: standardMessages,
    reply_text: replyText,
    ai_reply: replyText,
    customer_message: replyText,
    qr_image_url: qrImageUrl,
    handoff_required: Boolean(agentResponse?.handoff?.required),
    handoff_priority: agentResponse?.handoff?.priority || 'P2',
    conversation_id: agentResponse?.conversation_id || null,
    version: 'v2',
    content: {
      messages: manychatMessages,
    },
  }
}

/**
 * Express Handler hợp nhất cho Cloud Bridge (luôn trả về HTTP 200 OK an toàn)
 */
export function createCloudBridgeHandler(defaultFormat = 'universal') {
  return async function handleCloudBridgeRequest(req, res) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8')

    // Tùy chọn xác thực Token cầu nối (nếu người dùng đặt CLOUD_BRIDGE_TOKEN trên Render)
    if (config.CLOUD_BRIDGE_TOKEN) {
      const authHeader = String(req.headers['authorization'] || '')
      const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader.trim()
      const suppliedToken = String(
        bearer || req.headers['x-bridge-token'] || req.query?.token || req.body?.token || ''
      ).trim()

      const expectedBuf = Buffer.from(config.CLOUD_BRIDGE_TOKEN)
      const suppliedBuf = Buffer.from(suppliedToken)
      if (expectedBuf.length !== suppliedBuf.length || !crypto.timingSafeEqual(expectedBuf, suppliedBuf)) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized Cloud Bridge token',
          messages: [],
        })
      }
    }

    const input = extractCloudBridgeInput(req, defaultFormat)

    // 1. Kiểm tra Kill Switch: Nếu chủ shop tạm tắt kênh hoặc tắt toàn cục -> trả mảng rỗng để bot im lặng
    if (killSwitch.isGlobalStopped() || !killSwitch.isChannelAllowed(input.channel)) {
      return res.status(200).json(
        formatCloudBridgeResponse({
          replyText: null,
          format: input.format,
        })
      )
    }

    // 2. Nếu khách bấm "Bắt đầu" hoặc gửi nhãn dán/ảnh không kèm chữ
    if (!input.text) {
      const welcome = input.customerName
        ? `Dạ QuanNguyenS xin chào ${input.customerName} ạ! ✨ Bên mình có các dòng pijama sợi tự nhiên cao cấp siêu êm mát. Bạn đang cần tư vấn mẫu, chọn size theo chiều cao cân nặng hay kiểm tra đơn hàng cứ nhắn QuanNguyenS ngay nhé!`
        : `Dạ QuanNguyenS xin chào bạn ạ! ✨ Bên mình có các dòng pijama sợi tự nhiên cao cấp siêu êm mát. Bạn đang cần tư vấn mẫu, chọn size theo chiều cao cân nặng hay kiểm tra đơn hàng cứ nhắn QuanNguyenS ngay nhé!`

      return res.status(200).json(
        formatCloudBridgeResponse({
          replyText: welcome,
          format: input.format,
        })
      )
    }

    try {
      const db = getDb()
      const orchestrator = new MayOrchestrator(db)
      const conversationState = {}
      if (input.customerName) {
        conversationState.customerName = input.customerName
      }

      const agentResponse = await orchestrator.processMessage({
        text: input.text,
        channel: input.channel,
        senderId: input.senderId,
        conversationState,
        isCopilot: false,
      })

      // Nếu khách giận dữ / khiếu nại cần chuyển giao con người (Handoff P0/P1) -> Báo động khẩn cho Chủ shop
      if (agentResponse?.handoff?.required && agentResponse.handoff.reason_code !== 'HUMAN_ACTIVE') {
        alertNotifier
          .sendCriticalAlert({
            code: `HANDOFF_${input.channel}_${input.senderId}`,
            title: `Khách hàng ${input.customerName || input.senderId} (${input.channel}) cần Chủ shop hỗ trợ`,
            message: `Lý do: ${agentResponse.handoff.reason_code || 'ESCALATION'} (Mức ${agentResponse.handoff.priority}). Nội dung khách nhắn: "${input.text.slice(0, 180)}"`,
            details: {
              channel: input.channel,
              senderId: input.senderId,
              customerName: input.customerName,
              handoff: agentResponse.handoff,
            },
          })
          .catch(() => {})
      }

      // Nếu phiên đang do Chủ shop chat tay (CONVERSATION_OWNED_BY_HUMAN) -> im lặng trả messages: []
      if (agentResponse?.suppressed || !agentResponse?.customer_message) {
        return res.status(200).json(
          formatCloudBridgeResponse({
            replyText: null,
            format: input.format,
            agentResponse,
          })
        )
      }

      return res.status(200).json(
        formatCloudBridgeResponse({
          replyText: agentResponse.customer_message,
          format: input.format,
          agentResponse,
        })
      )
    } catch (err) {
      console.error(`🚨 [CLOUD BRIDGE ERROR - ${input.channel}]:`, err.message)
      alertNotifier
        .sendCriticalAlert({
          code: 'CLOUD_BRIDGE_RUNTIME_ERROR',
          title: 'Lỗi xử lý tin nhắn trên Cloud Bridge',
          message: err.message,
          details: { channel: input.channel, senderId: input.senderId },
        })
        .catch(() => {})

      // Luôn trả 200 OK kèm lời xin lỗi lịch sự để Botcake/AhaChat không bị đứt luồng
      const fallbackText =
        'Dạ QuanNguyenS đã nhận được tin nhắn của bạn rồi ạ! Hiện đường truyền hệ thống đang bận trong giây lát, bạn chờ một chút hoặc nhắn lại giúp QuanNguyenS ngay nhé ạ 💕'

      return res.status(200).json(
        formatCloudBridgeResponse({
          replyText: fallbackText,
          format: input.format,
        })
      )
    }
  }
}
