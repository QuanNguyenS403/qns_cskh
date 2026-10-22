/**
 * 3-LEVEL KILL SWITCH (Blueprint §6, §16.1, Prompt A B18)
 * Level 1: Global Kill Switch (Dừng toàn bộ hành động ghi / AI tự động)
 * Level 2: Action-Level Kill Switch (Bật/tắt từng action: commit_order, refund, prepare_order_change, etc.)
 * Level 3: Channel-Level Kill Switch (Bật/tắt từng kênh: web, messenger, instagram, threads, zalo)
 */

class KillSwitchManager {
  constructor() {
    this.globalStopped = false
    this.actionSwitches = new Map()
    this.channelSwitches = new Map()

    // Mặc định các action nhạy cảm (như refund) có thể tắt trước khi được cấp quyền
    this.actionSwitches.set('refund', true) // true = active, false = disabled
    this.actionSwitches.set('commit_order', true)
    this.actionSwitches.set('prepare_order', true)
    this.actionSwitches.set('order_change', true)
    this.actionSwitches.set('reserve_stock', true)

    // Kênh mặc định
    this.channelSwitches.set('web', true)
    this.channelSwitches.set('messenger', true)
    this.channelSwitches.set('instagram', true)
    this.channelSwitches.set('threads', true)
    this.channelSwitches.set('zalo', true)
  }

  // ── Global Level ──────────────────────────────────
  setGlobalKill(stopped, reason = 'Admin triggered global kill switch') {
    this.globalStopped = Boolean(stopped)
    this.globalReason = reason
    return { globalStopped: this.globalStopped, reason }
  }

  isGlobalStopped() {
    return this.globalStopped
  }

  // ── Action Level ──────────────────────────────────
  setActionState(actionName, enabled, reason = '') {
    this.actionSwitches.set(actionName, Boolean(enabled))
    return { action: actionName, enabled: Boolean(enabled), reason }
  }

  isActionAllowed(actionName) {
    if (this.globalStopped) return false
    if (!this.actionSwitches.has(actionName)) return true // default allow if not explicitly gated
    return this.actionSwitches.get(actionName) === true
  }

  // ── Channel Level ─────────────────────────────────
  setChannelState(channelName, enabled, reason = '') {
    this.channelSwitches.set(channelName.toLowerCase(), Boolean(enabled))
    return { channel: channelName.toLowerCase(), enabled: Boolean(enabled), reason }
  }

  isChannelAllowed(channelName) {
    if (this.globalStopped) return false
    const key = channelName.toLowerCase()
    if (!this.channelSwitches.has(key)) return false // fail-closed for unknown channels
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
    this.actionSwitches.set('refund', true)
    this.actionSwitches.set('commit_order', true)
    this.channelSwitches.set('web', true)
  }
}

export const killSwitch = new KillSwitchManager()
