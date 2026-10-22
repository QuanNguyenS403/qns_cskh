import crypto from 'crypto'
import { config } from '../config/env.js'

// In-memory set để ngăn chặn replay token (single-use within TTL window)
const consumedTokens = new Set()

export function hashPayload(payload) {
  const normalized = JSON.stringify(payload, Object.keys(payload || {}).sort())
  return crypto.createHash('sha256').update(normalized).digest('hex')
}

export function generateConfirmationToken({
  tenantId = config.DEFAULT_TENANT_ID,
  shopId = config.DEFAULT_SHOP_ID,
  customerId,
  actionType,
  targetId,
  targetVersion = 1,
  payload,
  ttlSeconds = 300, // 5 phút TTL theo Blueprint §10.4
  secret = config.CONFIRMATION_SECRET,
}) {
  const issuedAt = Math.floor(Date.now() / 1000)
  const expiresAt = issuedAt + ttlSeconds
  const payloadSha256 = hashPayload(payload)

  const tokenData = {
    tid: tenantId,
    sid: shopId,
    cid: customerId,
    act: actionType,
    tgt: targetId,
    ver: targetVersion,
    phs: payloadSha256,
    iat: issuedAt,
    exp: expiresAt,
  }

  const encodedData = Buffer.from(JSON.stringify(tokenData)).toString('base64url')
  const signature = crypto
    .createHmac('sha256', secret)
    .update(encodedData)
    .digest('base64url')

  return `${encodedData}.${signature}`
}

export function verifyConfirmationToken({
  token,
  expectedAction = null,
  currentPayload = null,
  secret = config.CONFIRMATION_SECRET,
  consume = true,
}) {
  if (!token || typeof token !== 'string' || !token.includes('.')) {
    return { valid: false, code: 'INVALID_FORMAT', error: 'Token xác nhận không đúng định dạng' }
  }

  const [encodedData, signature] = token.split('.')
  if (!encodedData || !signature) {
    return { valid: false, code: 'MALFORMED', error: 'Token thiếu dữ liệu hoặc chữ ký' }
  }

  // 1. Kiểm tra chữ ký bằng timingSafeEqual
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(encodedData)
    .digest('base64url')

  const sigBuffer = Buffer.from(signature)
  const expectedSigBuffer = Buffer.from(expectedSignature)

  if (sigBuffer.length !== expectedSigBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedSigBuffer)) {
    return { valid: false, code: 'SIGNATURE_MISMATCH', error: 'Chữ ký token xác nhận không hợp lệ' }
  }

  // 2. Parse dữ liệu token
  let tokenData
  try {
    tokenData = JSON.parse(Buffer.from(encodedData, 'base64url').toString('utf-8'))
  } catch (err) {
    return { valid: false, code: 'PARSE_ERROR', error: 'Không thể giải mã dữ liệu token' }
  }

  const nowSec = Math.floor(Date.now() / 1000)

  // 3. Kiểm tra hạn dùng (TTL)
  if (tokenData.exp && nowSec > tokenData.exp) {
    return { valid: false, code: 'EXPIRED', error: 'Token xác nhận đã hết hạn (quá 5 phút)' }
  }

  // 4. Kiểm tra replay / single-use
  if (consumedTokens.has(token)) {
    return { valid: false, code: 'ALREADY_CONSUMED', error: 'Token này đã được sử dụng trước đó' }
  }

  // 5. Kiểm tra đúng action
  if (expectedAction && tokenData.act !== expectedAction) {
    return {
      valid: false,
      code: 'ACTION_MISMATCH',
      error: `Hành động không khớp (Token cấp cho ${tokenData.act}, yêu cầu thực hiện ${expectedAction})`,
    }
  }

  // 6. Kiểm tra hash payload (nếu có payload hiện tại để so khớp)
  if (currentPayload) {
    const currentHash = hashPayload(currentPayload)
    if (currentHash !== tokenData.phs) {
      return {
        valid: false,
        code: 'PAYLOAD_MUTATED',
        error: 'Nội dung giao dịch đã bị thay đổi so với thời điểm lập đề xuất xác nhận',
      }
    }
  }

  // 7. Đánh dấu đã dùng nếu consume = true
  if (consume) {
    consumedTokens.add(token)
    // Tự động dọn dẹp token sau khi hết hạn mà không giữ event loop
    const timer = setTimeout(() => consumedTokens.delete(token), Math.max(1, (tokenData.exp - nowSec + 10)) * 1000)
    if (timer && timer.unref) timer.unref()
  }

  return {
    valid: true,
    tokenData,
  }
}
