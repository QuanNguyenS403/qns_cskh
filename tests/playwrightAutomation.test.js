import test from 'node:test'
import assert from 'node:assert/strict'
import { BrowserManager } from '../src/automation/browserManager.js'
import { MetaBusinessSuiteAgent } from '../src/automation/metaBusinessSuiteAgent.js'
import { AutoPilotService } from '../src/automation/autoPilotService.js'
import { killSwitch } from '../src/config/killSwitch.js'
import app from '../src/server.js'

test('Playwright Automation - BrowserManager & Configuration', async (t) => {
  const manager = new BrowserManager({
    headless: true,
    userDataDir: './tmp/test_playwright_profile',
    storageStatePath: './tmp/test_storage_state.json',
  })

  assert.strictEqual(manager.headless, true)
  assert.strictEqual(manager.isReady(), false)
})

test('Playwright Automation - MetaBusinessSuiteAgent Shop Signature Detection', async (t) => {
  const agent = new MetaBusinessSuiteAgent()

  // 1. Kiểm tra chữ ký Shop hợp lệ
  assert.strictEqual(agent.isShopSignature('Dạ QuanNguyenS xin chào anh/chị!'), true)
  assert.strictEqual(agent.isShopSignature('Dạ QNS rất hân hạnh được phục vụ'), true)
  assert.strictEqual(agent.isShopSignature('Mình là trợ lý AI của QuanNguyenS'), true)
  assert.strictEqual(agent.isShopSignature('Dạ bộ The Classic Set có giá 480.000đ'), true)
  assert.strictEqual(agent.isShopSignature('Anh/chị cho em xin chiều cao cân nặng để tư vấn size theo chiều cao cân nặng nhé'), true)

  // 2. Tin nhắn của khách không được nhận nhầm là Shop
  assert.strictEqual(agent.isShopSignature('Shop ơi còn size L không?'), false)
  assert.strictEqual(agent.isShopSignature('Tư vấn giúp em với ạ'), false)
  assert.strictEqual(agent.isShopSignature('1m65 55kg mặc vừa không shop'), false)
  assert.strictEqual(agent.isShopSignature(''), false)
  assert.strictEqual(agent.isShopSignature(null), false)
})

test('Playwright Automation - AutoPilotService State & Rate Limiting', async (t) => {
  const service = new AutoPilotService({
    pollIntervalMs: 5000,
    maxRepliesPerHour: 2,
    autoReply: true,
    stateFilePath: null,
  })

  const initialStatus = service.getStatus()
  assert.strictEqual(initialStatus.state, 'STOPPED')
  assert.strictEqual(initialStatus.rateLimit.maxPerHour, 2)
  assert.strictEqual(initialStatus.rateLimit.sentInLastHour, 0)

  // Kiểm tra Rate limit
  assert.strictEqual(service.canSendRateLimit(), true)
  service.recordReplySent()
  assert.strictEqual(service.stats.totalRepliesSent, 1)

  service.recordReplySent()
  assert.strictEqual(service.stats.totalRepliesSent, 2)
  assert.strictEqual(service.canSendRateLimit(), false) // Đã đạt limit 2 tin/h

  // Test pause
  service.pause()
  assert.strictEqual(service.getStatus().state, 'PAUSED')

  // Test stop
  await service.stop()
  assert.strictEqual(service.getStatus().state, 'STOPPED')
})

test('Playwright Automation - Kill Switch Circuit Protection', async (t) => {
  const service = new AutoPilotService({ stateFilePath: null })

  // Giả lập khóa kênh playwright
  killSwitch.setChannelState('playwright', false, 'Bảo trì khẩn cấp')
  assert.strictEqual(killSwitch.isChannelAllowed('playwright'), false)

  const cycleResult = await service.runCycle()
  assert.strictEqual(cycleResult.skipped, true)
  assert.strictEqual(cycleResult.reason, 'KILL_SWITCH_ACTIVE')

  // Mở lại kênh
  killSwitch.setChannelState('playwright', true, 'Hoàn tất bảo trì')
  assert.strictEqual(killSwitch.isChannelAllowed('playwright'), true)
})

test('Playwright Automation - Server Control API Endpoints', async (t) => {
  const server = app.listen(0)
  const port = server.address().port

  try {
    // 1. GET /api/automation/status
    const statusRes = await fetch(`http://localhost:${port}/api/automation/status`)
    assert.strictEqual(statusRes.status, 200)
    const statusData = await statusRes.json()
    assert.strictEqual(statusData.success, true)
    assert.ok(statusData.service.includes('Playwright'))

    // 2. POST /api/automation/pause
    const pauseRes = await fetch(`http://localhost:${port}/api/automation/pause`, { method: 'POST' })
    assert.strictEqual(pauseRes.status, 200)
    const pauseData = await pauseRes.json()
    assert.strictEqual(pauseData.success, true)
    assert.strictEqual(pauseData.status.state, 'PAUSED')

    // 3. POST /api/automation/stop
    const stopRes = await fetch(`http://localhost:${port}/api/automation/stop`, { method: 'POST' })
    assert.strictEqual(stopRes.status, 200)
    const stopData = await stopRes.json()
    assert.strictEqual(stopData.success, true)
    assert.strictEqual(stopData.status.state, 'STOPPED')
  } finally {
    server.close()
  }
})
