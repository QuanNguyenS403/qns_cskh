import test from 'node:test'
import assert from 'node:assert/strict'
import { killSwitch } from '../../src/config/killSwitch.js'

test('Phase 0 - Kill Switch 3 Cấp (Global, Action, Channel)', (t) => {
  killSwitch.reset()

  // 1. Kiểm tra trạng thái bình thường
  assert.strictEqual(killSwitch.isGlobalStopped(), false)
  assert.strictEqual(killSwitch.isActionAllowed('commit_order'), true)
  assert.strictEqual(killSwitch.isChannelAllowed('web'), true)

  // 2. Action Level Switch: Tắt riêng tính năng 'refund'
  killSwitch.setActionState('refund', false, 'Tạm dừng hoàn tiền để đối soát số dư')
  assert.strictEqual(killSwitch.isActionAllowed('refund'), false, 'Action refund phải bị chặn')
  assert.strictEqual(killSwitch.isActionAllowed('commit_order'), true, 'Action commit_order vẫn hoạt động bình thường')

  // Bật lại refund
  killSwitch.setActionState('refund', true)
  assert.strictEqual(killSwitch.isActionAllowed('refund'), true, 'Action refund phải hoạt động trở lại')

  // 3. Channel Level Switch: Tắt riêng kênh 'zalo'
  killSwitch.setChannelState('zalo', false, 'Template Zalo đang chờ duyệt lại')
  assert.strictEqual(killSwitch.isChannelAllowed('zalo'), false, 'Kênh Zalo phải bị ngắt')
  assert.strictEqual(killSwitch.isChannelAllowed('web'), true, 'Kênh Web vẫn hoạt động')

  // Kênh lạ chưa cấu hình phải fail-closed
  assert.strictEqual(killSwitch.isChannelAllowed('unknown_channel_xyz'), false, 'Kênh chưa đăng ký phải fail-closed')

  // 4. Global Kill Switch: Kích hoạt khẩn cấp toàn hệ thống
  killSwitch.setGlobalKill(true, 'Khẩn cấp: Tạm dừng toàn bộ agent')
  assert.strictEqual(killSwitch.isGlobalStopped(), true)
  assert.strictEqual(killSwitch.isActionAllowed('commit_order'), false, 'Toàn bộ action phải bị chặn khi Global Kill bật')
  assert.strictEqual(killSwitch.isActionAllowed('refund'), false)
  assert.strictEqual(killSwitch.isChannelAllowed('web'), false, 'Toàn bộ channel phải bị chặn khi Global Kill bật')

  // Mở lại Global
  killSwitch.setGlobalKill(false)
  assert.strictEqual(killSwitch.isGlobalStopped(), false)
  assert.strictEqual(killSwitch.isActionAllowed('commit_order'), true, 'Sau khi mở lại Global, action được phép chạy lại')

  killSwitch.reset()
})
