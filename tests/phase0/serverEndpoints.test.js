import test from 'node:test'
import assert from 'node:assert/strict'
import app from '../../src/server.js'
import { config } from '../../src/config/env.js'

test('Phase 0 - Server Endpoints & Health Gateway', async (t) => {
  const server = app.listen(0)
  const port = server.address().port
  const baseUrl = `http://localhost:${port}`

  try {
    // 1. Test /livez
    const livezRes = await fetch(`${baseUrl}/livez`)
    const livezData = await livezRes.json()
    assert.strictEqual(livezRes.status, 200)
    assert.strictEqual(livezData.status, 'alive')

    // 2. Test /readyz
    const readyzRes = await fetch(`${baseUrl}/readyz`)
    const readyzData = await readyzRes.json()
    assert.strictEqual(readyzRes.status, 200)
    assert.strictEqual(readyzData.status, 'ready')

    // 3. Test /api/health
    const healthRes = await fetch(`${baseUrl}/api/health`)
    const healthData = await healthRes.json()
    assert.strictEqual(healthRes.status, 200)
    assert.strictEqual(healthData.service, 'QuanNguyenS AI CSKH Action Gateway')
    assert.ok(healthData.killSwitch)

    // 4. Test Meta Webhook Verify GET
    const verifyToken = config.META_VERIFY_TOKEN || 'test_meta_verify_token'
    const metaVerifyRes = await fetch(`${baseUrl}/api/webhook/meta?hub.mode=subscribe&hub.verify_token=${verifyToken}&hub.challenge=test_challenge_abc`)
    const metaVerifyText = await metaVerifyRes.text()
    assert.strictEqual(metaVerifyRes.status, 200)
    assert.strictEqual(metaVerifyText, 'test_challenge_abc')

    // 5. Test Kill Switch Admin API - Không có auth -> Phải bị 401 Unauthorized
    const unauthGetRes = await fetch(`${baseUrl}/api/admin/killswitch`)
    assert.strictEqual(unauthGetRes.status, 401, 'GET /api/admin/killswitch không auth phải trả về 401 (C2)')

    const unauthPostRes = await fetch(`${baseUrl}/api/admin/killswitch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level: 'action', target: 'refund', state: false }),
    })
    assert.strictEqual(unauthPostRes.status, 401, 'POST /api/admin/killswitch không auth phải trả về 401 (C2)')

    // 6. Test Kill Switch Admin API - Có Bearer Auth đúng -> 200 OK
    const authHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.ADMIN_SECRET}`,
    }

    const authGetRes = await fetch(`${baseUrl}/api/admin/killswitch`, { headers: authHeaders })
    assert.strictEqual(authGetRes.status, 200)

    const killSwitchRes = await fetch(`${baseUrl}/api/admin/killswitch`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        level: 'action',
        target: 'refund',
        state: false,
        reason: 'Testing admin toggle',
      }),
    })
    const killSwitchData = await killSwitchRes.json()
    assert.strictEqual(killSwitchRes.status, 200)
    assert.strictEqual(killSwitchData.status.actions.refund, false)

    // Reset lại
    await fetch(`${baseUrl}/api/admin/killswitch`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        level: 'action',
        target: 'refund',
        state: true,
      }),
    })
  } finally {
    server.close()
  }
})
