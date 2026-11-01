import test from 'node:test'
import assert from 'node:assert/strict'
import app from '../src/server.js'
import { killSwitch } from '../src/config/killSwitch.js'
import { splitIntoMessageBubbles, formatCloudBridgeResponse } from '../src/channels/cloudBridgeAdapter.js'

test('Cloud Bridge - Message Bubble Splitter & VietQR Image Extraction', () => {
  const longText = 'Đoạn 1 pijama sợi tự nhiên.\n\n' + 'A'.repeat(1900) + '\n\nĐoạn cuối cùng.'
  const bubbles = splitIntoMessageBubbles(longText, 1850)
  assert.ok(bubbles.length >= 2)
  for (const b of bubbles) {
    assert.ok(b.length <= 1850)
  }

  const qrReply =
    'Dạ mời bạn quét mã VietQR giảm 5%: https://img.vietqr.io/image/VCB-1050773506-compact2.png?amount=370500&addInfo=QNS'
  const botcakeFormatted = formatCloudBridgeResponse({ replyText: qrReply, format: 'universal' })
  assert.strictEqual(botcakeFormatted.success, true)
  assert.strictEqual(botcakeFormatted.messages.length, 2)
  assert.strictEqual(botcakeFormatted.messages[1].attachment.type, 'image')
  assert.ok(botcakeFormatted.messages[1].attachment.payload.url.startsWith('https://img.vietqr.io/image/'))

  const manychatFormatted = formatCloudBridgeResponse({ replyText: qrReply, format: 'manychat' })
  assert.strictEqual(manychatFormatted.version, 'v2')
  assert.strictEqual(manychatFormatted.content.messages.length, 2)
  assert.strictEqual(manychatFormatted.content.messages[1].type, 'image')
})

test('Cloud Bridge - Botcake, AhaChat, and ManyChat Live HTTP Endpoints', async () => {
  const server = app.listen(0)
  const port = server.address().port
  const baseUrl = `http://localhost:${port}`

  try {
    // 1. Botcake POST JSON API (Messenger)
    const bcRes = await fetch(`${baseUrl}/api/webhook/botcake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        psid: 'bc_fb_user_001',
        full_name: 'Lan Anh',
        last_input_text: 'Set Daybreak giá bao nhiêu shop ơi?',
        platform: 'messenger',
      }),
    })
    assert.strictEqual(bcRes.status, 200)
    const bcData = await bcRes.json()
    assert.strictEqual(bcData.success, true)
    assert.ok(Array.isArray(bcData.messages) && bcData.messages.length >= 1)
    assert.ok(bcData.messages[0].text.includes('390.000'))
    assert.strictEqual(bcData.ai_reply, bcData.customer_message)

    // 2. AhaChat GET Query JSON API (Instagram Direct)
    const ahaRes = await fetch(
      `${baseUrl}/api/webhook/ahachat?sender_id=ig_user_002&name=Minh%20Chau&channel=instagram&text=${encodeURIComponent('Mình cao 1m60 nặng 50kg mặc size gì vừa ạ?')}`
    )
    assert.strictEqual(ahaRes.status, 200)
    const ahaData = await ahaRes.json()
    assert.ok(Array.isArray(ahaData.messages) && ahaData.messages.length >= 1)
    assert.ok(ahaData.messages[0].text.length > 20)

    // 3. ManyChat Dynamic Block v2
    const mcRes = await fetch(`${baseUrl}/api/webhook/manychat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subscriber: {
          id: 'mc_sub_003',
          name: 'Thu Ha',
          last_input_text: 'Cho mình xin số tài khoản ngân hàng của shop nhé',
        },
        channel: 'instagram',
      }),
    })
    assert.strictEqual(mcRes.status, 200)
    const mcData = await mcRes.json()
    assert.strictEqual(mcData.version, 'v2')
    assert.ok(Array.isArray(mcData.content.messages) && mcData.content.messages.length >= 1)
    assert.strictEqual(mcData.content.messages[0].type, 'text')
    assert.ok(mcData.content.messages[0].text.includes('1050773506'))

    // 4. Empty input ("Get Started" button / sticker) -> HTTP 200 Welcome (never 400/500)
    const emptyRes = await fetch(`${baseUrl}/api/webhook/botcake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ psid: 'bc_new_visitor', full_name: 'Ngọc Mai', text: '' }),
    })
    assert.strictEqual(emptyRes.status, 200)
    const emptyData = await emptyRes.json()
    assert.ok(emptyData.messages[0].text.includes('Ngọc Mai'))

    // 5. Kill Switch protection -> HTTP 200 silent messages: []
    killSwitch.setChannelState('instagram', false, 'Test tạm dừng Instagram')
    const pausedRes = await fetch(`${baseUrl}/api/webhook/botcake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ psid: 'ig_paused_test', text: 'Alo shop', platform: 'instagram' }),
    })
    assert.strictEqual(pausedRes.status, 200)
    const pausedData = await pausedRes.json()
    assert.strictEqual(pausedData.messages.length, 0)
  } finally {
    killSwitch.setChannelState('instagram', true, 'Mở lại Instagram sau test')
    server.close()
  }
})
