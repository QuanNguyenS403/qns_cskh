/**
 * GOOGLE SHEETS LIVE SYNC & POST-DELIVERY CARE SERVICE
 * 
 * Chức năng:
 * 1. Tiếp nhận Webhook từ Google Apps Script khi chủ shop (Quan) xác nhận "ĐÃ GIAO / ĐÃ NHẬN" trên Google Sheet.
 * 2. Tự động quét (Polling) định kỳ dữ liệu Google Sheet qua link CSV export hoàn toàn MIỄN PHÍ VÔ THỜI HẠN.
 * 3. Kích hoạt ngay lập tức quy trình Chăm sóc khách hàng sau khi nhận hàng (Post-Delivery Care):
 *    - Hỏi han tình trạng kiện hàng có nguyên vẹn không
 *    - Thăm dò cảm nhận mặc thử phom dáng và chất vải sợi tự nhiên
 *    - Hướng dẫn bảo quản/giặt ủi
 *    - Sẵn sàng hỗ trợ đổi size nếu cần
 * 4. Kiểm soát chống gửi trùng (Idempotent B06) và ghi nhận nhật ký (Audit Log B07).
 */

import { config } from '../config/env.js'
import { messengerAdapter } from '../channels/messengerAdapter.js'
import { instagramAdapter } from '../channels/instagramAdapter.js'
import { zaloAdapter } from '../channels/zaloAdapter.js'
import { auditLogger } from '../security/auditLogger.js'

/**
 * Trình phân tích CSV chuẩn gọn nhẹ không cần thư viện ngoài
 */
export function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length === 0) return []

  const parseRow = (line) => {
    const row = []
    let inQuotes = false
    let current = ''

    for (let i = 0; i < line.length; i++) {
      const char = line[i]
      if (char === '"' || char === "'") {
        if (inQuotes && line[i + 1] === char) {
          current += char
          i++
        } else {
          inQuotes = !inQuotes
        }
      } else if (char === ',' && !inQuotes) {
        row.push(current.trim())
        current = ''
      } else {
        current += char
      }
    }
    row.push(current.trim())
    return row
  }

  const rawHeaders = parseRow(lines[0])
  const headers = rawHeaders.map((h) => h.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim())

  const results = []
  for (let i = 1; i < lines.length; i++) {
    const rowValues = parseRow(lines[i])
    if (rowValues.length === 0 || (rowValues.length === 1 && !rowValues[0])) continue

    const obj = {}
    headers.forEach((h, idx) => {
      obj[h] = rowValues[idx] || ''
    })
    results.push({ ...obj, _raw: rowValues })
  }

  return results
}

/**
 * Tạo nội dung tin nhắn chăm sóc khách hàng sau khi nhận hàng thành công
 * Đúng phong cách May: Tinh tế, ấm áp, nhã nhặn, tôn trọng khách hàng.
 */
export function buildPostDeliveryMessage({ customerName = 'bạn', orderId, itemsSummary = '' }) {
  const greeting = customerName && customerName !== 'bạn' && customerName !== 'Khách hàng'
    ? `Dạ May chào ${customerName} ạ! `
    : `Dạ May chào bạn ạ! `

  const itemPart = itemsSummary ? ` gồm ${itemsSummary}` : ''
  const orderPart = orderId ? ` (đơn hàng #${orderId})` : ''

  return (
    `${greeting}May thấy kiện hàng của mình${itemPart}${orderPart} đã được giao thành công tới tay mình rồi ạ 🥰\n\n` +
    `May nhắn để hỏi thăm xem kiện hàng tới nơi có nguyên vẹn không ạ? Bạn đã mở ra mặc thử đồ chưa, phom dáng và chất vải sợi tự nhiên mặc lên người có vừa vặn và thoải mái như ý bạn không ạ?\n\n` +
    `Nếu có bất kỳ điểm nào bạn chưa ưng ý cần đổi size, hoặc cần May hướng dẫn cách giặt ủi/bảo quản để giữ cho sợi vải luôn mềm mượt, bạn cứ nhắn May để được hỗ trợ ngay bất cứ lúc nào nhé ạ!`
  )
}

export class GoogleSheetsService {
  /**
   * Xử lý xác nhận đơn hàng thành công từ Google Sheet (Webhook hoặc Poller)
   */
  static async handleDeliveryConfirmation(db, {
    orderId,
    customerName = 'Khách hàng',
    customerPhone = '',
    items = '',
    channel = 'messenger',
    channelSenderId = '',
    carrier = 'Viettel Post',
    trackingCode = '',
    confirmedBy = 'chủ shop',
  }) {
    if (!orderId) {
      return { status: 'REJECTED', error: 'Thiếu mã đơn hàng (orderId)' }
    }

    const cleanOrderId = String(orderId).trim().toUpperCase()
    const now = new Date().toISOString()
    const businessKey = `checkin:${cleanOrderId}`

    // 1. Kiểm tra chống gửi trùng (Idempotent B06)
    const existingJob = db.prepare(`SELECT * FROM jobs WHERE business_key = ?`).get(businessKey)
    if (existingJob && existingJob.status === 'COMPLETED') {
      return {
        status: 'DUPLICATE',
        message: `Đơn hàng ${cleanOrderId} đã được May gửi tin nhắn chăm sóc sau nhận hàng trước đó.`,
        completed_at: existingJob.updated_at,
      }
    }

    // 2. Cập nhật hoặc ghi nhận đơn hàng trong Database
    const existingOrder = db.prepare(`SELECT * FROM orders WHERE order_id = ?`).get(cleanOrderId)
    if (existingOrder) {
      db.prepare(`
        UPDATE orders
        SET status = 'DELIVERED', updated_at = ?
        WHERE order_id = ?
      `).run(now, cleanOrderId)
    } else {
      // Lưu trữ đơn hàng mới từ Google Sheet vào DB để May có ngữ cảnh hỗ trợ
      db.prepare(`
        INSERT INTO orders (
          order_id, tenant_id, shop_id, customer_name, customer_phone,
          shipping_address, items_json, subtotal, shipping_fee, discount, total,
          status, payment_status, source, created_at, updated_at
        ) VALUES (?, 'quannguyens_corp', 'quannguyens_pijama', ?, ?, 'Google Sheet Entry', ?, 0, 0, 0, 0, 'DELIVERED', 'PAID', 'google_sheet', ?, ?)
      `).run(cleanOrderId, customerName, customerPhone, JSON.stringify([{ name: items || 'Sản phẩm Pijama QuanNguyenS' }]), now, now)
    }

    // 3. Cập nhật hoặc tạo vận đơn trong bảng shipments
    const existingShipment = db.prepare(`SELECT * FROM shipments WHERE order_id = ?`).get(cleanOrderId)
    if (existingShipment) {
      db.prepare(`
        UPDATE shipments
        SET status = 'DELIVERED', delivered_at = ?, updated_at = ?
        WHERE order_id = ?
      `).run(now, now, cleanOrderId)
    } else {
      const shipmentId = `SHIP-${cleanOrderId}`
      db.prepare(`
        INSERT INTO shipments (
          id, tenant_id, shop_id, order_id, carrier, tracking_code, status, delivered_at, created_at, updated_at
        ) VALUES (?, 'quannguyens_corp', 'quannguyens_pijama', ?, ?, ?, 'DELIVERED', ?, ?, ?)
      `).run(shipmentId, cleanOrderId, carrier, trackingCode || cleanOrderId, now, now, now)
    }

    // 4. Soạn tin nhắn chăm sóc tinh tế
    const careText = buildPostDeliveryMessage({
      customerName,
      orderId: cleanOrderId,
      itemsSummary: items,
    })

    // 5. Gửi tin nhắn chăm sóc qua kênh tương ứng
    let dispatchResult = { sent: false, channel: channel.toLowerCase(), reason: 'NO_ACTIVE_RECIPIENT_ID' }
    const ch = channel.toLowerCase()

    if (channelSenderId) {
      if (ch === 'messenger') {
        dispatchResult = await messengerAdapter.sendMessage({
          recipientId: channelSenderId,
          text: careText,
          messageType: 'support',
        })
      } else if (ch === 'instagram') {
        dispatchResult = await instagramAdapter.sendMessage({
          recipientId: channelSenderId,
          text: careText,
          messageType: 'support',
        })
      } else if (ch === 'zalo') {
        dispatchResult = await zaloAdapter.sendTextMessage({
          recipientId: channelSenderId,
          text: careText,
        })
      }
    }

    // 6. Lưu vào hàng đợi outbox để lưu vết lịch sử tin nhắn
    const outboxId = `OUT-${Date.now()}-${cleanOrderId}`
    db.prepare(`
      INSERT INTO outbox (
        id, tenant_id, shop_id, channel, recipient_id, message_type, content_json,
        idempotency_key, status, eligible_after, expires_at
      ) VALUES (?, 'quannguyens_corp', 'quannguyens_pijama', ?, ?, 'support', ?, ?, ?, ?, ?)
    `).run(
      outboxId,
      ch,
      channelSenderId || customerPhone || cleanOrderId,
      JSON.stringify({ text: careText }),
      `outbox:checkin:${cleanOrderId}`,
      dispatchResult.sent ? 'DELIVERED' : 'PENDING',
      now,
      new Date(Date.now() + 86400000).toISOString()
    )

    // 7. Đánh dấu Job hoàn tất trong bảng jobs (chống trùng vĩnh viễn)
    const jobId = `JOB-CHECKIN-${cleanOrderId}`
    db.prepare(`
      INSERT INTO jobs (
        id, business_key, job_type, payload_json, status, eligible_after, created_at, updated_at
      ) VALUES (?, ?, 'post_delivery_care', ?, 'COMPLETED', ?, ?, ?)
      ON CONFLICT(business_key) DO UPDATE SET
        status = 'COMPLETED',
        updated_at = excluded.updated_at
    `).run(
      jobId,
      businessKey,
      JSON.stringify({ orderId: cleanOrderId, customerName, channel, channelSenderId, careText, dispatchResult }),
      now,
      now,
      now
    )

    // 8. Ghi Audit Log hành động nghiệp vụ
    auditLogger.logAction(db, {
      actorType: 'AI_AGENT',
      actorId: 'may',
      actionName: 'POST_DELIVERY_CARE_SENT',
      targetEntityType: 'order',
      targetEntityId: cleanOrderId,
      inputPayload: { orderId: cleanOrderId, customerName, channel, confirmedBy },
      resultStatus: 'SUCCEEDED',
      evidenceRef: `job:${jobId}`,
    })

    console.log(`✅ [POST-DELIVERY CARE] Đã kích hoạt chăm sóc đơn #${cleanOrderId} (${customerName}) qua kênh ${ch}. Kết quả gửi: ${dispatchResult.sent ? 'THÀNH CÔNG' : 'LƯU HÀNG ĐỢI'}`)

    return {
      status: 'SUCCEEDED',
      orderId: cleanOrderId,
      customerName,
      channel: ch,
      dispatched: dispatchResult.sent,
      messagePreview: careText,
      timestamp: now,
    }
  }

  /**
   * Tự động quét (Poll) Google Sheet định kỳ qua liên kết CSV Export Free
   */
  static async pollGoogleSheet(db) {
    let csvUrl = config.GOOGLE_SHEET_CSV_URL

    // Nếu chỉ có GOOGLE_SHEET_ID, tự động tạo URL CSV export miễn phí của Google
    if (!csvUrl && config.GOOGLE_SHEET_ID) {
      csvUrl = `https://docs.google.com/spreadsheets/d/${config.GOOGLE_SHEET_ID}/gviz/tq?tqx=out:csv`
    }

    if (!csvUrl) {
      return { status: 'SKIPPED', reason: 'Chưa cấu hình GOOGLE_SHEET_CSV_URL hoặc GOOGLE_SHEET_ID' }
    }

    try {
      const response = await globalThis.fetch(csvUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) QuanNguyenS-CSKH-Poller/1.0',
        },
      })

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          console.warn(`⚠️ [GOOGLE SHEETS POLL] Google Sheet đang ở chế độ Riêng tư (HTTP ${response.status}). Vui lòng chọn "Chia sẻ" > "Bất kỳ ai có đường liên kết đều có thể xem" trên Google Sheet.`)
        } else {
          console.warn(`⚠️ [GOOGLE SHEETS POLL] Lỗi tải CSV từ Google Sheet (HTTP ${response.status})`)
        }
        return { status: 'ERROR', httpStatus: response.status }
      }

      const csvText = await response.text()
      if (csvText.startsWith('<!DOCTYPE html') || csvText.includes('<html')) {
        console.warn('⚠️ [GOOGLE SHEETS POLL] Google Sheet trả về trang đăng nhập HTML thay vì CSV. Vui lòng mở quyền "Bất kỳ ai có đường liên kết đều có thể xem" trên Google Sheet để hệ thống tự động đọc được dữ liệu.')
        return { status: 'RESTRICTED', error: 'Sheet is restricted. Requires "Anyone with link can view" permission.' }
      }

      const rows = parseCsv(csvText)

      let processedCount = 0

      for (const row of rows) {
        // Tìm các cột tương ứng theo các biến thể tên cột phổ biến
        const orderId = row['ma don'] || row['ma don hang'] || row['order id'] || row['order_id'] || row['ma'] || ''
        const status = (row['trang thai'] || row['status'] || row['tinh trang'] || '').toUpperCase()
        const customerName = row['ten khach'] || row['ten'] || row['khach hang'] || row['customer'] || row['ho ten'] || 'Khách hàng'
        const customerPhone = row['sdt'] || row['so dien thoai'] || row['phone'] || ''
        const items = row['san pham'] || row['items'] || row['don hang'] || row['mon hang'] || ''
        const channel = (row['kenh'] || row['channel'] || 'messenger').toLowerCase()
        const channelSenderId = row['id kenh'] || row['sender id'] || row['sender_id'] || row['id_khach'] || row['facebook_id'] || ''

        // Kiểm tra xem trạng thái có phải là ĐÃ GIAO / ĐÃ NHẬN thành công không
        const isDelivered = /ĐÃ GIAO|DA GIAO|ĐÃ NHẬN|DA NHAN|GIAO THÀNH CÔNG|GIAO THANH CONG|DELIVERED|THÀNH CÔNG/i.test(status)

        if (orderId && isDelivered) {
          const cleanOrderId = String(orderId).trim().toUpperCase()
          const businessKey = `checkin:${cleanOrderId}`

          // Kiểm tra xem đã xử lý chưa
          const existingJob = db.prepare(`SELECT id FROM jobs WHERE business_key = ?`).get(businessKey)
          if (!existingJob) {
            console.log(`📦 [GOOGLE SHEETS DISCOVERY] Phát hiện đơn hàng đã giao thành công: #${cleanOrderId} (${customerName})`)
            await this.handleDeliveryConfirmation(db, {
              orderId: cleanOrderId,
              customerName,
              customerPhone,
              items,
              channel,
              channelSenderId,
              confirmedBy: 'google_sheet_poller',
            })
            processedCount++
          }
        }
      }

      return { status: 'SUCCEEDED', rowsScanned: rows.length, processedCount }
    } catch (err) {
      console.error('🚨 [GOOGLE SHEETS POLL EXCEPTION]:', err.message)
      return { status: 'ERROR', error: err.message }
    }
  }

  /**
   * Khởi động tiến trình chạy nền tự động quét Google Sheet theo chu kỳ
   */
  static startPoller(db, intervalMs = config.GOOGLE_SHEET_POLL_INTERVAL_MS) {
    if (!config.GOOGLE_SHEET_CSV_URL && !config.GOOGLE_SHEET_ID) {
      console.log('ℹ️ [GOOGLE SHEETS POLLER] Chế độ quét nền chờ cấu hình (GOOGLE_SHEET_ID / GOOGLE_SHEET_CSV_URL). Webhook vẫn hoạt động tức thời 24/7.')
      return null
    }

    console.log(`🔄 [GOOGLE SHEETS POLLER] Đã kích hoạt quét tự động mỗi ${Math.round(intervalMs / 1000)} giây (Miễn phí 100% trọn đời).`)
    if (config.GOOGLE_SHEET_ID) {
      console.log(`   Theo dõi Sheet ID: ${config.GOOGLE_SHEET_ID}`)
    }

    // Chạy lần đầu ngay khi khởi động
    setTimeout(() => {
      this.pollGoogleSheet(db).catch((e) => console.error('Poller initial run error:', e.message))
    }, 5000)

    // Chạy định kỳ
    const timerId = setInterval(() => {
      this.pollGoogleSheet(db).catch((e) => console.error('Poller tick error:', e.message))
    }, intervalMs)

    return timerId
  }
}
