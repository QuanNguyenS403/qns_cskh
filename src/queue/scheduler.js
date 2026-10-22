import crypto from 'crypto'
import { getDb } from '../db/connection.js'
import { config } from '../config/env.js'
import { auditLogger } from '../security/auditLogger.js'

export class SchedulerService {
  constructor(db = null) {
    this._db = db
  }

  get db() {
    return this._db || getDb()
  }

  /**
   * Tạo hoặc cập nhật Job bền vững (Idempotent theo business_key)
   */
  upsertJob({
    businessKey,
    jobType,
    payload,
    eligibleAfter = new Date().toISOString(),
    expiresAt = null,
    maxAttempts = 5,
  }) {
    const payloadJson = typeof payload === 'string' ? payload : JSON.stringify(payload)
    const now = new Date().toISOString()
    const id = `job_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`

    try {
      this.db.prepare(`
        INSERT INTO jobs (
          id, business_key, job_type, payload_json, status,
          eligible_after, expires_at, max_attempts, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'READY', ?, ?, ?, ?, ?)
        ON CONFLICT(business_key) DO UPDATE SET
          eligible_after = excluded.eligible_after,
          expires_at = excluded.expires_at,
          payload_json = excluded.payload_json,
          updated_at = excluded.updated_at
      `).run(id, businessKey, jobType, payloadJson, eligibleAfter, expiresAt, maxAttempts, now, now)

      return { businessKey, status: 'READY' }
    } catch (err) {
      console.error(`🚨 [SCHEDULER ERROR] Lỗi tạo job:`, err.message)
      throw err
    }
  }

  /**
   * Worker nhận Job bằng cơ chế Lease Token chống Race Condition (Atomic Claim)
   */
  claimNextJob(jobType = null, leaseDurationSeconds = 60) {
    const now = new Date().toISOString()
    const leaseExpires = new Date(Date.now() + leaseDurationSeconds * 1000).toISOString()
    const leaseToken = crypto.randomBytes(16).toString('hex')

    // 1. Tìm job sẵn sàng (status = READY hoặc status = RUNNING nhưng lease đã quá hạn)
    let query = `
      SELECT id, business_key, job_type, payload_json, attempts, max_attempts
      FROM jobs
      WHERE (status = 'READY' OR (status = 'RUNNING' AND lease_expires_at < ?))
        AND eligible_after <= ?
        AND (expires_at IS NULL OR expires_at > ?)
        AND attempts < max_attempts
    `
    const params = [now, now, now]

    if (jobType) {
      query += ` AND job_type = ?`
      params.push(jobType)
    }

    query += ` ORDER BY eligible_after ASC LIMIT 1`

    const candidate = this.db.prepare(query).get(...params)
    if (!candidate) return null

    // 2. Cập nhật nguyên tử trạng thái RUNNING kèm lease_token
    const updateRes = this.db.prepare(`
      UPDATE jobs
      SET status = 'RUNNING',
          lease_token = ?,
          lease_expires_at = ?,
          attempts = attempts + 1,
          updated_at = ?
      WHERE id = ? AND (status = 'READY' OR lease_expires_at < ?)
    `).run(leaseToken, leaseExpires, now, candidate.id, now)

    if (updateRes.changes === 0) {
      // Bị worker khác claim trước (race condition prevented)
      return null
    }

    return {
      ...candidate,
      attempts: candidate.attempts + 1,
      payload: JSON.parse(candidate.payload_json),
      leaseToken,
      leaseExpiresAt: leaseExpires,
    }
  }

  /**
   * Hoàn tất Job thành công
   */
  completeJob(id, leaseToken) {
    const now = new Date().toISOString()
    return this.db.prepare(`
      UPDATE jobs
      SET status = 'COMPLETED', lease_token = NULL, lease_expires_at = NULL, updated_at = ?
      WHERE id = ? AND lease_token = ?
    `).run(now, id, leaseToken)
  }

  /**
   * Đánh dấu Job thất bại hoặc lên lịch Retry với Jitter
   */
  failJob(id, leaseToken, errorMessage, retryInSeconds = null) {
    const now = new Date().toISOString()
    if (retryInSeconds !== null && retryInSeconds > 0) {
      // Thêm jitter ngẫu nhiên 1-5 giây để tránh retry bão hòa
      const jitter = Math.floor(Math.random() * 5) + 1
      const nextEligible = new Date(Date.now() + (retryInSeconds + jitter) * 1000).toISOString()

      return this.db.prepare(`
        UPDATE jobs
        SET status = 'READY',
            lease_token = NULL,
            lease_expires_at = NULL,
            last_error = ?,
            eligible_after = ?,
            updated_at = ?
        WHERE id = ? AND lease_token = ?
      `).run(errorMessage, nextEligible, now, id, leaseToken)
    }

    return this.db.prepare(`
      UPDATE jobs
      SET status = 'FAILED',
          lease_token = NULL,
          lease_expires_at = NULL,
          last_error = ?,
          updated_at = ?
      WHERE id = ? AND lease_token = ?
    `).run(errorMessage, now, id, leaseToken)
  }

  /**
   * Lấy danh sách cam kết (Promises) đã quá hạn
   */
  checkOverduePromises() {
    const now = new Date().toISOString()
    return this.db.prepare(`
      SELECT * FROM promises
      WHERE status = 'PENDING' AND due_at < ?
      ORDER BY due_at ASC
    `).all(now)
  }
}

export const schedulerService = new SchedulerService()
