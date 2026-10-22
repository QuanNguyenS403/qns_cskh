import crypto from 'crypto'
import { getDb } from '../db/connection.js'
import { config } from '../config/env.js'
import { auditLogger } from '../security/auditLogger.js'

export class OutboxService {
  constructor(db = null) {
    this._db = db
  }

  get db() {
    return this._db || getDb()
  }

  /**
   * Đưa tin nhắn / thông báo vào Outbox bền vững
   */
  enqueueMessage({
    tenantId = config.DEFAULT_TENANT_ID,
    shopId = config.DEFAULT_SHOP_ID,
    channel,
    recipientId,
    messageType, // transactional | support | marketing
    content,
    idempotencyKey,
    eligibleAfter = new Date().toISOString(),
    ttlMinutes = 1440, // 24 giờ
  }) {
    const key = idempotencyKey || `outbox_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`
    const contentJson = typeof content === 'string' ? content : JSON.stringify(content)
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString()
    const now = new Date().toISOString()
    const id = `msg_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`

    try {
      this.db.prepare(`
        INSERT INTO outbox (
          id, tenant_id, shop_id, channel, recipient_id,
          message_type, content_json, idempotency_key, status,
          eligible_after, expires_at, attempts, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, 0, ?, ?)
      `).run(id, tenantId, shopId, channel, recipientId, messageType, contentJson, key, eligibleAfter, expiresAt, now, now)

      return { success: true, id, idempotencyKey: key, status: 'PENDING' }
    } catch (err) {
      if (err.message && err.message.includes('UNIQUE constraint failed')) {
        const existing = this.db.prepare('SELECT * FROM outbox WHERE idempotency_key = ?').get(key)
        return { success: true, id: existing.id, idempotencyKey: key, status: existing.status, isDuplicate: true }
      }
      throw err
    }
  }

  /**
   * Lấy các tin sẵn sàng gửi đi
   */
  fetchPendingMessages(limit = 10) {
    const now = new Date().toISOString()
    return this.db.prepare(`
      SELECT * FROM outbox 
      WHERE status = 'PENDING' AND eligible_after <= ? AND expires_at > ?
      ORDER BY eligible_after ASC
      LIMIT ?
    `).all(now, now, limit)
  }

  markSent(id, providerMessageId = null) {
    const now = new Date().toISOString()
    return this.db.prepare(`
      UPDATE outbox 
      SET status = 'SENT', provider_message_id = ?, updated_at = ?
      WHERE id = ?
    `).run(providerMessageId, now, id)
  }

  markFailed(id, errorMessage) {
    const now = new Date().toISOString()
    return this.db.prepare(`
      UPDATE outbox 
      SET status = 'FAILED', attempts = attempts + 1, error_message = ?, last_attempt_at = ?, updated_at = ?
      WHERE id = ?
    `).run(errorMessage, now, now, id)
  }

  markDeferred(id, nextEligibleAfter) {
    const now = new Date().toISOString()
    return this.db.prepare(`
      UPDATE outbox 
      SET status = 'PENDING', eligible_after = ?, updated_at = ?
      WHERE id = ?
    `).run(nextEligibleAfter, now, id)
  }

  markDenied(id, reason) {
    const now = new Date().toISOString()
    return this.db.prepare(`
      UPDATE outbox 
      SET status = 'DENIED', error_message = ?, updated_at = ?
      WHERE id = ?
    `).run(reason, now, id)
  }
}

export const outboxService = new OutboxService()
