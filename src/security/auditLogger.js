import crypto from 'crypto'
import { getDb } from '../db/connection.js'
import { config } from '../config/env.js'

/**
 * PII & Secret Redaction Helper
 * Che số điện thoại, email, số tài khoản, tokens, passwords
 */
export function redactSensitiveData(obj) {
  if (obj === null || obj === undefined) return obj
  if (typeof obj === 'string') {
    return obj
      // Che email: a***b@domain.com
      .replace(/([a-zA-Z0-9_\.-]{1,3})[a-zA-Z0-9_\.-]+@([a-zA-Z0-9\.-]+\.[a-zA-Z]{2,})/g, '$1***@$2')
      // Che SĐT Việt Nam: 098***082
      .replace(/(0[1-9]{1}[0-9]{1})[0-9]{4}([0-9]{3})/g, '$1***$2')
      // Che token / secret hex dài
      .replace(/[a-fA-F0-9]{32,64}/g, '[REDACTED_SECRET]')
  }

  if (Array.isArray(obj)) {
    return obj.map(redactSensitiveData)
  }

  if (typeof obj === 'object') {
    const copy = {}
    const sensitiveKeys = ['password', 'secret', 'token', 'apiKey', 'api_key', 'accessToken', 'access_token', 'privateKey', 'private_key', 'otp']

    for (const [k, v] of Object.entries(obj)) {
      if (sensitiveKeys.some((sk) => k.toLowerCase().includes(sk))) {
        copy[k] = '[REDACTED_SECRET]'
      } else {
        copy[k] = redactSensitiveData(v)
      }
    }
    return copy
  }

  return obj
}

export class AuditLogger {
  constructor(db = null) {
    this._db = db
  }

  get db() {
    return this._db || getDb()
  }

  logAction({
    operationId = null,
    tenantId = config.DEFAULT_TENANT_ID,
    shopId = config.DEFAULT_SHOP_ID,
    actorType = 'AI_AGENT', // AI_AGENT | HUMAN_ADMIN | SYSTEM_JOB | CUSTOMER
    actorId = 'may',
    actionName,
    targetEntityType,
    targetEntityId,
    inputPayload = null,
    resultStatus, // SUCCEEDED | REJECTED | FAILED | UNKNOWN
    resultEnvelope = null,
    evidenceRef = null,
  }) {
    const opId = operationId || `op_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`
    const redactedInput = inputPayload ? JSON.stringify(redactSensitiveData(inputPayload)) : null
    const redactedResult = resultEnvelope ? JSON.stringify(redactSensitiveData(resultEnvelope)) : null
    const now = new Date().toISOString()

    try {
      this.db.prepare(`
        INSERT INTO action_audits (
          id, operation_id, tenant_id, shop_id, actor_type, actor_id,
          action_name, target_entity_type, target_entity_id,
          input_payload_redacted, result_status, result_envelope, evidence_ref, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        `audit_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`,
        opId,
        tenantId,
        shopId,
        actorType,
        actorId,
        actionName,
        targetEntityType,
        targetEntityId,
        redactedInput,
        resultStatus,
        redactedResult,
        evidenceRef,
        now
      )

      return { operationId: opId, recorded: true }
    } catch (err) {
      console.error(`🚨 [AUDIT ERROR] Không thể ghi audit log:`, err.message)
      return { operationId: opId, recorded: false, error: err.message }
    }
  }

  getAuditByOperation(operationId) {
    return this.db.prepare('SELECT * FROM action_audits WHERE operation_id = ?').get(operationId)
  }

  listAuditsByEntity(entityType, entityId) {
    return this.db.prepare(`
      SELECT * FROM action_audits 
      WHERE target_entity_type = ? AND target_entity_id = ?
      ORDER BY created_at DESC
    `).all(entityType, entityId)
  }
}

export const auditLogger = new AuditLogger()
