import { auditLogger } from '../security/auditLogger.js'

class KillSwitchManager {
  constructor(db = null) {
    this.db = db
    this.globalStopped = false
    this.globalReason = null
    this.actionSwitches = new Map()
    this.channelSwitches = new Map()

    this._initDefaults()
  }

  _initDefaults() {
    this.actionSwitches.set('refund', true)
    this.actionSwitches.set('commit_order', true)
    this.actionSwitches.set('prepare_order', true)
    this.actionSwitches.set('order_change', true)
    this.actionSwitches.set('reserve_stock', true)

    this.channelSwitches.set('web', true)
    this.channelSwitches.set('messenger', true)
    this.channelSwitches.set('instagram', true)
    this.channelSwitches.set('threads', true)
    this.channelSwitches.set('zalo', true)
    this.channelSwitches.set('playwright', true)
  }

  /**
   * Khởi tạo và nạp trạng thái từ CSDL SQLite bền vững (C2)
   */
  init(db) {
    if (!db) return
    this.db = db

    try {
      const tableCheck = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='kill_switch_state'`).get()
      if (!tableCheck) return

      const rows = db.prepare(`SELECT scope, target, state, reason FROM kill_switch_state`).all()
      for (const row of rows) {
        const isEnabled = row.state === 1
        if (row.scope === 'global') {
          this.globalStopped = !isEnabled
          this.globalReason = row.reason
        } else if (row.scope.startsWith('action:')) {
          this.actionSwitches.set(row.target, isEnabled)
        } else if (row.scope.startsWith('channel:')) {
          this.channelSwitches.set(row.target.toLowerCase(), isEnabled)
        }
      }
    } catch (err) {
      console.warn('⚠️ [KILL SWITCH INIT WARNING]:', err.message)
    }
  }

  _persist(scope, target, state, reason = '') {
    if (!this.db) return
    try {
      const now = new Date().toISOString()
      this.db.prepare(`
        INSERT INTO kill_switch_state (scope, target, state, reason, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(scope) DO UPDATE SET
          state = excluded.state,
          reason = excluded.reason,
          updated_at = excluded.updated_at
      `).run(scope, target, state ? 1 : 0, reason, now)

      try {
        auditLogger.logAction(this.db, {
          actorType: 'ADMIN',
          actorId: 'admin_killswitch',
          actionName: 'KILL_SWITCH_UPDATED',
          targetEntityType: 'kill_switch',
          targetEntityId: scope,
          inputPayload: { scope, target, state, reason },
          resultStatus: 'SUCCEEDED',
        })
      } catch {}
    } catch (err) {
      console.warn(`⚠️ [KILL SWITCH PERSIST ERROR]:`, err.message)
    }
  }

  // ── Global Level ──────────────────────────────────
  setGlobalKill(stopped, reason = 'Admin triggered global kill switch') {
    this.globalStopped = Boolean(stopped)
    this.globalReason = reason
    this._persist('global', 'system', !this.globalStopped, reason)
    return { globalStopped: this.globalStopped, reason }
  }

  isGlobalStopped() {
    return this.globalStopped
  }

  // ── Action Level ──────────────────────────────────
  setActionState(actionName, enabled, reason = '') {
    const isEnabled = Boolean(enabled)
    this.actionSwitches.set(actionName, isEnabled)
    this._persist(`action:${actionName}`, actionName, isEnabled, reason)
    return { action: actionName, enabled: isEnabled, reason }
  }

  isActionAllowed(actionName) {
    if (this.globalStopped) return false
    if (!this.actionSwitches.has(actionName)) return true
    return this.actionSwitches.get(actionName) === true
  }

  // ── Channel Level ─────────────────────────────────
  setChannelState(channelName, enabled, reason = '') {
    const key = channelName.toLowerCase()
    const isEnabled = Boolean(enabled)
    this.channelSwitches.set(key, isEnabled)
    this._persist(`channel:${key}`, key, isEnabled, reason)
    return { channel: key, enabled: isEnabled, reason }
  }

  isChannelAllowed(channelName) {
    if (this.globalStopped) return false
    const key = channelName.toLowerCase()
    if (!this.channelSwitches.has(key)) return false
    return this.channelSwitches.get(key) === true
  }

  // ── Full Status Report ────────────────────────────
  getStatus() {
    return {
      global: {
        stopped: this.globalStopped,
        reason: this.globalReason || null,
      },
      actions: Object.fromEntries(this.actionSwitches),
      channels: Object.fromEntries(this.channelSwitches),
    }
  }

  reset() {
    this.globalStopped = false
    this.globalReason = null
    this.actionSwitches.clear()
    this.channelSwitches.clear()
    this._initDefaults()
    if (this.db) {
      try {
        this.db.prepare(`DELETE FROM kill_switch_state`).run()
      } catch {}
    }
  }
}

export const killSwitch = new KillSwitchManager()

