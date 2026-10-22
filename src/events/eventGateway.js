import crypto from 'crypto'
import { getDb } from '../db/connection.js'
import { config } from '../config/env.js'
import { auditLogger, AuditLogger } from '../security/auditLogger.js'

export class EventGateway {
  constructor(db = null, audit = null) {
    this._db = db
    this._audit = audit
  }

  get db() {
    return this._db || getDb()
  }

  get audit() {
    return this._audit || (this._db ? new AuditLogger(this._db) : auditLogger)
  }

  /**
   * Xác thực chữ ký webhook an toàn bằng timingSafeEqual
   */
  verifySignature(rawBody, signatureHeader, secret) {
    if (!signatureHeader || !secret) return false

    const cleanSig = signatureHeader.replace(/^sha256=/i, '').trim()
    const computed = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')

    const bufSig = Buffer.from(cleanSig, 'hex')
    const bufComputed = Buffer.from(computed, 'hex')

    if (bufSig.length !== bufComputed.length) return false
    return crypto.timingSafeEqual(bufSig, bufComputed)
  }

  /**
   * Tiếp nhận sự kiện có xác thực và chống trùng lặp tuyệt đối (Idempotency)
   */
  ingestEvent({
    eventId,
    source, // sepay | viettel_post | messenger | instagram | web
    tenantId = config.DEFAULT_TENANT_ID,
    shopId = config.DEFAULT_SHOP_ID,
    eventType,
    entityType,
    entityId,
    entityVersion = 1,
    occurredAt = new Date().toISOString(),
    correlationId = null,
    payload,
    signatureVerified = true,
  }) {
    if (!eventId || !source || !eventType) {
      throw new Error('Thiếu thông tin bắt buộc: eventId, source, eventType')
    }

    const payloadJson = typeof payload === 'string' ? payload : JSON.stringify(payload)
    const now = new Date().toISOString()
    const internalId = `evt_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`

    try {
      // 1. Thử ghi nhận sự kiện vào CSDL bền vững với UNIQUE(source, event_id)
      const stmt = this.db.prepare(`
        INSERT INTO events (
          id, event_id, source, tenant_id, shop_id,
          event_type, entity_type, entity_id, entity_version,
          occurred_at, received_at, correlation_id, payload_json,
          signature_verified, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)

      stmt.run(
        internalId,
        eventId,
        source,
        tenantId,
        shopId,
        eventType,
        entityType || 'unknown',
        entityId || 'none',
        entityVersion,
        occurredAt,
        now,
        correlationId,
        payloadJson,
        signatureVerified ? 1 : 0,
        now
      )

      this.audit.logAction({
        tenantId,
        shopId,
        actorType: 'SYSTEM_JOB',
        actorId: source,
        actionName: `EVENT_INGESTED:${eventType}`,
        targetEntityType: entityType || 'event',
        targetEntityId: eventId,
        inputPayload: payload,
        resultStatus: 'SUCCEEDED',
        evidenceRef: internalId,
      })

      return {
        isDuplicate: false,
        status: 'ACCEPTED',
        id: internalId,
        eventId,
        source,
      }
    } catch (err) {
      // Nếu vi phạm UNIQUE constraint (source, event_id) -> Đây là sự kiện lặp (T13 Gate requirement)
      if (err.message && err.message.includes('UNIQUE constraint failed')) {
        console.log(`ℹ️ [EVENT GATEWAY IDEMPOTENT] Sự kiện trùng lặp từ ${source} (eventId: ${eventId}). Bỏ qua side-effect.`)

        this.audit.logAction({
          tenantId,
          shopId,
          actorType: 'SYSTEM_JOB',
          actorId: source,
          actionName: `EVENT_DUPLICATE_IGNORED:${eventType}`,
          targetEntityType: entityType || 'event',
          targetEntityId: eventId,
          inputPayload: payload,
          resultStatus: 'SUCCEEDED',
          evidenceRef: `duplicate:${source}:${eventId}`,
        })

        return {
          isDuplicate: true,
          status: 'DUPLICATE_IGNORED',
          eventId,
          source,
        }
      }

      console.error(`🚨 [EVENT GATEWAY ERROR]:`, err.message)
      throw err
    }
  }

  getEvent(source, eventId) {
    return this.db.prepare('SELECT * FROM events WHERE source = ? AND event_id = ?').get(source, eventId)
  }
}

export const eventGateway = new EventGateway()
