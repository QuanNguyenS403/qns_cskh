import test from 'node:test'
import assert from 'node:assert/strict'
import app from '../../src/server.js'
import { config, validateEnvironment, INSECURE_DEFAULT_SECRETS } from '../../src/config/env.js'
import { getDb } from '../../src/db/connection.js'
import { MessengerAdapter } from '../../src/channels/messengerAdapter.js'
import { InstagramAdapter } from '../../src/channels/instagramAdapter.js'
import { ZaloAdapter } from '../../src/channels/zaloAdapter.js'
import { LLMClient } from '../../src/agent/llmClient.js'

test('Phase 0 - Security Hardening & Vulnerability Verification (C1-C5, H1-H13)', async (t) => {
  const server = app.listen(0)
  const port = server.address().port
  const baseUrl = `http://localhost:${port}`
  const db = getDb()

  const originalSepayKey = config.SEPAY_WEBHOOK_API_KEY
  const originalZaloKey = config.ZALO_SECRET_KEY
  const testSepayKey = 'test_sepay_security_key_2026'
  const testZaloKey = 'test_zalo_secret_mac_key_2026'

  config.SEPAY_WEBHOOK_API_KEY = testSepayKey
  config.ZALO_SECRET_KEY = testZaloKey

  try {
    // ----------------------------------------------------
    // N01: Fail-Closed Environment Validation (R-01, C2)
    // ----------------------------------------------------
    await t.test('N01: Production fails to start with insecure default secrets', () => {
      const insecureConfig = {
        NODE_ENV: 'production',
        CSKH_ADMIN_SECRET: 'dev_admin_secret_key_32bytes_min', // Trong danh sách INSECURE_DEFAULT_SECRETS
        CSKH_CONFIRMATION_SECRET: 'dev_secret_confirmation_key_32bytes_min',
        CSKH_WEBHOOK_SECRET: 'short_key',
      }
      
      const checkResult = validateEnvironment(insecureConfig)
      assert.strictEqual(checkResult.isValid, false)
      assert.ok(checkResult.errors.length > 0)
      assert.ok(checkResult.errors.some(e => e.includes('CSKH_ADMIN_SECRET')))

      assert.throws(
        () => validateEnvironment(insecureConfig, { throwOnError: true }),
        /FATAL CONFIG ERROR/,
        'validateEnvironment phải throw error khi throwOnError: true'
      )
    })

    // ----------------------------------------------------
    // N02: SePay rejects unauthorized requests (C1)
    // ----------------------------------------------------
    await t.test('N02: SePay rejects requests without valid API key with 401', async () => {
      // 1. Không có header auth
      const noAuthRes = await fetch(`${baseUrl}/api/webhook/sepay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 12345, amountIn: 500000 }),
      })
      assert.strictEqual(noAuthRes.status, 401)
      const noAuthData = await noAuthRes.json()
      assert.strictEqual(noAuthData.success, false)

      // 2. Có auth nhưng sai key
      const wrongAuthRes = await fetch(`${baseUrl}/api/webhook/sepay`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer wrong_invalid_sepay_key',
        },
        body: JSON.stringify({ id: 12345, amountIn: 500000 }),
      })
      assert.strictEqual(wrongAuthRes.status, 401)
    })

    // ----------------------------------------------------
    // N03: SePay rejects wrong account or outbound money (C1, H11)
    // ----------------------------------------------------
    await t.test('N03: SePay rejects wrong receiving account or outbound money', async () => {
      const authHeaders = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${testSepayKey}`,
      }

      // Tài khoản nhận không khớp với VIETQR_ACCOUNT_NO của shop
      const wrongAccRes = await fetch(`${baseUrl}/api/webhook/sepay`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          id: 99001,
          accountNumber: '9999999999999',
          transferType: 'in',
          amountIn: 100000,
        }),
      })
      assert.strictEqual(wrongAccRes.status, 400)
      const wrongAccData = await wrongAccRes.json()
      assert.match(wrongAccData.error, /Tài khoản nhận giao dịch không khớp/i)

      // Chiều dòng tiền ra (transferType: 'out')
      const outboundRes = await fetch(`${baseUrl}/api/webhook/sepay`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          id: 99002,
          accountNumber: config.VIETQR_ACCOUNT_NO || '1050773506',
          transferType: 'out',
          amountOut: 100000,
        }),
      })
      assert.strictEqual(outboundRes.status, 400)
      const outboundData = await outboundRes.json()
      assert.match(outboundData.error, /chuyển tiền đi/i)
    })

    // ----------------------------------------------------
    // N04: SePay rejects missing transaction ID (C1, H11)
    // ----------------------------------------------------
    await t.test('N04: SePay rejects payload missing transaction ID', async () => {
      const authHeaders = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${testSepayKey}`,
      }

      const noIdRes = await fetch(`${baseUrl}/api/webhook/sepay`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          accountNumber: config.VIETQR_ACCOUNT_NO || '1050773506',
          transferType: 'in',
          amountIn: 100000,
        }),
      })
      assert.strictEqual(noIdRes.status, 400)
      const noIdData = await noIdRes.json()
      assert.match(noIdData.error, /Thiếu mã giao dịch thanh toán bắt buộc/i)
    })

    // ----------------------------------------------------
    // N05: SePay duplicate transaction idempotent (C1, Gate T13)
    // ----------------------------------------------------
    await t.test('N05: SePay duplicate transaction is idempotent', async () => {
      const authHeaders = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${testSepayKey}`,
      }
      const txId = `SEC_TEST_${Date.now()}`

      const testOrderId = `QNS-SEC-${Date.now()}`
      db.prepare(`
        INSERT INTO orders (
          order_id, tenant_id, shop_id, customer_name, customer_phone,
          shipping_address, items_json, subtotal, total, status, payment_status,
          created_at, updated_at
        ) VALUES (
          ?, 'quannguyens_corp', 'quannguyens_pijama',
          'Test Customer', '0981753082', 'Hanoi', '[]',
          650000, 650000, 'CONFIRMED', 'AWAITING_PAYMENT',
          datetime('now'), datetime('now')
        )
      `).run(testOrderId)

      const payload = {
        id: txId,
        accountNumber: config.VIETQR_ACCOUNT_NO || '1050773506',
        transferType: 'in',
        amountIn: 650000,
        content: `${testOrderId} THANH TOAN DON HANG`,
      }

      // First call
      const res1 = await fetch(`${baseUrl}/api/webhook/sepay`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(payload),
      })
      assert.strictEqual(res1.status, 200)
      const data1 = await res1.json()
      assert.strictEqual(data1.success, true)

      // Duplicate call
      const res2 = await fetch(`${baseUrl}/api/webhook/sepay`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(payload),
      })
      assert.strictEqual(res2.status, 200)
      const data2 = await res2.json()
      assert.strictEqual(data2.success, true)
      assert.match(data2.message, /Idempotent/i)
    })

    // ----------------------------------------------------
    // N06: Google Sheets Webhook Auth & Non-existent Order (C4, H12)
    // ----------------------------------------------------
    await t.test('N06: Google Sheets webhook rejects missing secret and non-existent order', async () => {
      // 1. Missing secret -> 401
      const noSecretRes = await fetch(`${baseUrl}/api/webhook/google-sheets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: 'ORD_999' }),
      })
      assert.strictEqual(noSecretRes.status, 401)

      // 2. Non-existent order -> 404 (Không được tạo đơn ma 0đ)
      const secret = config.GOOGLE_SHEET_WEBHOOK_SECRET || 'quannguyens_sheets_secret_2026'
      const notFoundRes = await fetch(`${baseUrl}/api/webhook/google-sheets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-sheets-secret': secret,
        },
        body: JSON.stringify({
          orderId: 'ORD_NON_EXISTENT_PHANTOM_99999',
          customerName: 'Kẻ tấn công tạo đơn ma',
          items: 'Váy Pijama ma 0đ',
        }),
      })
      assert.strictEqual(notFoundRes.status, 404)
      const notFoundData = await notFoundRes.json()
      assert.match(notFoundData.error, /Không tìm thấy đơn hàng/i)

      // Verify no phantom order was created in DB
      const phantom = db.prepare('SELECT * FROM orders WHERE order_id = ?').get('ORD_NON_EXISTENT_PHANTOM_99999')
      assert.strictEqual(phantom, undefined, 'Không được tạo đơn hàng ma 0đ vào CSDL (D1/C4)')
    })

    // ----------------------------------------------------
    // N07: Durable Kill Switch State (C2, Gate T10)
    // ----------------------------------------------------
    await t.test('N07: Admin killswitch persists across restart and rejects unauthenticated', async () => {
      // 1. Unauthenticated rejects
      const unauth = await fetch(`${baseUrl}/api/admin/killswitch`)
      assert.strictEqual(unauth.status, 401)

      // 2. Authenticated set
      const authHeaders = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.ADMIN_SECRET}`,
      }
      const setRes = await fetch(`${baseUrl}/api/admin/killswitch`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          level: 'action',
          target: 'test_sec_action',
          state: false,
          reason: 'Security test durable persistence',
        }),
      })
      assert.strictEqual(setRes.status, 200)

      // 3. Verify in SQLite database
      const row = db.prepare('SELECT state, reason FROM kill_switch_state WHERE scope = ?').get('action:test_sec_action')
      assert.ok(row, 'Trạng thái kill switch phải được lưu bền vững vào bảng kill_switch_state trong SQLite')
      assert.strictEqual(row.state, 0)
      assert.strictEqual(row.reason, 'Security test durable persistence')

      // 4. Reset
      await fetch(`${baseUrl}/api/admin/killswitch`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          level: 'action',
          target: 'test_sec_action',
          state: true,
        }),
      })
    })

    // ----------------------------------------------------
    // N08: Zalo Webhook Signature Verification (C4)
    // ----------------------------------------------------
    await t.test('N08: Zalo webhook rejects invalid signature with 401', async () => {
      const res = await fetch(`${baseUrl}/api/webhook/zalo`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-zevent-signature': 'mac=invalid_mac_signature_hex_1234567890abcdef',
        },
        body: JSON.stringify({
          event_name: 'user_send_text',
          sender: { id: 'zalo_user_123' },
          recipient: { id: 'oa_123' },
          message: { msg_id: 'msg_sec_001', text: 'Xin chào' },
        }),
      })
      assert.strictEqual(res.status, 401)
      const data = await res.json()
      assert.match(data.error, /Unauthorized Zalo Webhook signature/i)
    })

    // ----------------------------------------------------
    // N21: No Secrets in URL Query Strings (C5, H10)
    // ----------------------------------------------------
    await t.test('N21: Messenger, Instagram, and Gemini do not pass secrets in query strings', async () => {
      let interceptedUrl = null
      let interceptedHeaders = null

      const mockFetch = async (url, options) => {
        interceptedUrl = url
        interceptedHeaders = options?.headers || {}
        return {
          ok: true,
          status: 200,
          json: async () => ({
            recipient_id: '123',
            message_id: 'mid.mock',
            candidates: [{ content: { parts: [{ text: 'MOCK_LLM_RESPONSE' }] } }],
          }),
        }
      }

      // Messenger (Cung cấp lastCustomerInteractionAt để canSend cho phép gửi phản hồi CSKH)
      const messenger = new MessengerAdapter('fake_test_messenger_token')
      await messenger.sendMessage({
        recipientId: '12345',
        text: 'Test message',
        lastCustomerInteractionAt: new Date().toISOString(),
        fetchImpl: mockFetch,
      })
      assert.ok(interceptedUrl)
      assert.strictEqual(interceptedUrl.includes('access_token='), false, 'Messenger không được gắn access_token vào URL query string')
      assert.ok(interceptedHeaders['Authorization'] || interceptedHeaders['authorization'], 'Messenger phải dùng Bearer token trong Header')

      // Instagram
      interceptedUrl = null
      interceptedHeaders = null
      const instagram = new InstagramAdapter('fake_test_ig_token')
      await instagram.sendMessage({
        recipientId: '12345',
        text: 'Test message',
        lastCustomerInteractionAt: new Date().toISOString(),
        fetchImpl: mockFetch,
      })
      assert.ok(interceptedUrl)
      assert.strictEqual(interceptedUrl.includes('access_token='), false, 'Instagram không được gắn access_token vào URL query string')
      assert.ok(interceptedHeaders['Authorization'] || interceptedHeaders['authorization'], 'Instagram phải dùng Bearer token trong Header')

      // Gemini LLM
      interceptedUrl = null
      interceptedHeaders = null
      const client = new LLMClient()
      client.apiKey = 'fake_test_key_for_header_check'
      await client.generateMayResponse({
        systemPrompt: 'System prompt',
        userMessage: 'Hello',
        fetchImpl: mockFetch,
      })
      assert.ok(interceptedUrl)
      assert.strictEqual(interceptedUrl.includes('key='), false, 'Gemini LLM không được gắn API key vào URL query parameter')
      assert.ok(interceptedHeaders['x-goog-api-key'], 'Gemini LLM phải gửi API key qua header x-goog-api-key')
    })

    // ----------------------------------------------------
    // N22: Adapters in Production Reject Missing Token (H2)
    // ----------------------------------------------------
    await t.test('N22: Adapters in production fail-closed when token is missing (no fake mock success)', async () => {
      const origEnv = config.NODE_ENV
      config.NODE_ENV = 'production'

      try {
        const messenger = new MessengerAdapter('')
        const resMessenger = await messenger.sendMessage({
          recipientId: '123',
          text: 'Hello',
          lastCustomerInteractionAt: new Date().toISOString(),
        })
        assert.strictEqual(resMessenger.sent, false)
        assert.strictEqual(resMessenger.errorCode, 'TOKEN_MISSING')

        const instagram = new InstagramAdapter('')
        const resInstagram = await instagram.sendMessage({
          recipientId: '123',
          text: 'Hello',
          lastCustomerInteractionAt: new Date().toISOString(),
        })
        assert.strictEqual(resInstagram.sent, false)
        assert.strictEqual(resInstagram.errorCode, 'TOKEN_MISSING')

        const zalo = new ZaloAdapter('')
        const resZalo = await zalo.sendTextMessage({
          recipientId: '123',
          text: 'Hello',
        })
        assert.strictEqual(resZalo.sent, false)
        assert.strictEqual(resZalo.errorCode, 'TOKEN_MISSING')
      } finally {
        config.NODE_ENV = origEnv
      }
    })
  } finally {
    config.SEPAY_WEBHOOK_API_KEY = originalSepayKey
    config.ZALO_SECRET_KEY = originalZaloKey
    server.close()
  }
})
