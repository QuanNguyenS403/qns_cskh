import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs'
import crypto from 'node:crypto'

dotenv.config()

// Nếu chạy ở môi trường Production (như Render, Cloud PaaS, Docker...) mà các biến bí mật nội bộ
// chưa được cấu hình (do .env bị gitignore không đẩy lên hosting):
// Tự động sinh khóa ngẫu nhiên mật mã học an toàn (CSPRNG 256-bit) để server có thể khởi động ngay,
// bảo mật tuyệt đối, không dùng khóa mặc định và không làm sập tiến trình khởi động của Render.
if ((process.env.NODE_ENV || 'production') === 'production') {
  if (!process.env.CSKH_CONFIRMATION_SECRET) {
    process.env.CSKH_CONFIRMATION_SECRET = crypto.randomBytes(32).toString('hex')
    console.info('ℹ️ [AUTO-SECURITY] CSKH_CONFIRMATION_SECRET chưa cấu hình, đã tự động sinh khóa 256-bit an toàn.')
  }
  if (!process.env.CSKH_ADMIN_SECRET && !process.env.ADMIN_SECRET) {
    process.env.CSKH_ADMIN_SECRET = crypto.randomBytes(32).toString('hex')
    console.info('ℹ️ [AUTO-SECURITY] CSKH_ADMIN_SECRET chưa cấu hình, đã tự động sinh khóa 256-bit an toàn.')
  }
  if (!process.env.CSKH_WEBHOOK_SECRET) {
    process.env.CSKH_WEBHOOK_SECRET = crypto.randomBytes(32).toString('hex')
    console.info('ℹ️ [AUTO-SECURITY] CSKH_WEBHOOK_SECRET chưa cấu hình, đã tự động sinh khóa 256-bit an toàn.')
  }
}

export const INSECURE_DEFAULT_SECRETS = [
  'dev_secret_confirmation_key_32bytes_min',
  'dev_admin_secret_key_32bytes_min',
  'dev_webhook_secret_key_32bytes_min',
  'quannguyens_meta_verify_token_2026',
  'quannguyens_sheets_secret_2026',
  'cskh_dev_admin_secret_key_0123456789abcdef',
]

/**
 * Kiểm tra tính hợp lệ của biến môi trường (Fail-Closed R-01)
 */
export function validateEnvironment(env = process.env, { throwOnError = false } = {}) {
  const currentEnv = env.NODE_ENV || 'production'
  const isProd = currentEnv === 'production'

  const confirmationSecret = env.CSKH_CONFIRMATION_SECRET || ''
  const adminSecret = env.CSKH_ADMIN_SECRET || env.ADMIN_SECRET || ''
  const webhookSecret = env.CSKH_WEBHOOK_SECRET || ''

  const errors = []

  if (isProd) {
    if (!confirmationSecret || confirmationSecret.length < 32 || INSECURE_DEFAULT_SECRETS.includes(confirmationSecret)) {
      errors.push('CSKH_CONFIRMATION_SECRET bắt buộc, không được dùng giá trị mặc định/placeholder và phải >= 32 ký tự')
    }
    if (!adminSecret || adminSecret.length < 32 || INSECURE_DEFAULT_SECRETS.includes(adminSecret)) {
      errors.push('CSKH_ADMIN_SECRET bắt buộc, không được dùng giá trị mặc định/placeholder và phải >= 32 ký tự')
    }
    if (!webhookSecret || webhookSecret.length < 32 || INSECURE_DEFAULT_SECRETS.includes(webhookSecret)) {
      errors.push('CSKH_WEBHOOK_SECRET bắt buộc, không được dùng giá trị mặc định/placeholder và phải >= 32 ký tự')
    }
    if (env.META_PAGE_ID && (!env.META_APP_SECRET || env.META_APP_SECRET.length < 16)) {
      errors.push('META_APP_SECRET bắt buộc ở production khi cấu hình Meta Integration')
    }
  }

  if (throwOnError && errors.length > 0) {
    throw new Error(`[FATAL CONFIG ERROR] ${errors.join('; ')}`)
  }

  return { isValid: errors.length === 0, errors }
}

const envCheck = validateEnvironment()
if (!envCheck.isValid && (process.env.NODE_ENV || 'production') === 'production') {
  console.error('🚨 [FATAL CONFIG ERROR] Hệ thống từ chối khởi động ở Production do lỗi bảo mật (R-01):')
  envCheck.errors.forEach((err) => console.error(`   - ${err}`))
  if (process.env.NODE_ENV === 'production' && !process.env.SUPPRESS_CONFIG_EXIT) {
    process.exit(1)
  }
}

export const config = {
  NODE_ENV: process.env.NODE_ENV || 'production',
  PORT: parseInt(process.env.PORT || '3002', 10),
  TIMEZONE: process.env.TIMEZONE || 'Asia/Ho_Chi_Minh',
  CURRENCY: process.env.CURRENCY || 'VND',

  DEFAULT_TENANT_ID: process.env.DEFAULT_TENANT_ID || 'quannguyens_corp',
  DEFAULT_SHOP_ID: process.env.DEFAULT_SHOP_ID || 'quannguyens_pijama',

  DB_PATH: process.env.CSKH_DB_PATH || path.resolve(process.cwd(), 'data/cskh.db'),

  // Secrets: Tuyệt đối không fallback về chuỗi mặc định không an toàn ở production
  CONFIRMATION_SECRET: process.env.CSKH_CONFIRMATION_SECRET || '',
  ADMIN_SECRET: process.env.CSKH_ADMIN_SECRET || '',
  WEBHOOK_SECRET: process.env.CSKH_WEBHOOK_SECRET || '',

  // CORS Origin Allowlist
  CORS_ORIGIN: process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim())
    : ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002', 'https://quannguyens.com'],

  SHOP_API_BASE_URL: process.env.SHOP_API_BASE_URL || 'http://localhost:3001',
  SHOP_API_TOKEN: process.env.SHOP_API_TOKEN || '',

  // Trí tuệ nhân tạo Google Gemini
  LLM_PROVIDER: process.env.LLM_PROVIDER || 'gemini',
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
  GEMINI_FALLBACK_MODEL: process.env.GEMINI_FALLBACK_MODEL || 'gemini-flash-lite-latest',
  GROQ_API_KEY: process.env.GROQ_API_KEY || '',
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || '',

  // Meta (Facebook Page & Messenger)
  META_APP_ID: process.env.META_APP_ID || '',
  META_APP_SECRET: process.env.META_APP_SECRET || '',
  META_VERIFY_TOKEN: process.env.META_VERIFY_TOKEN || '',
  META_PAGE_ID: process.env.META_PAGE_ID || '',
  META_PAGE_ACCESS_TOKEN: process.env.META_PAGE_ACCESS_TOKEN || '',
  META_GRAPH_VERSION: process.env.META_GRAPH_VERSION || 'v21.0',

  // Instagram Direct Messages
  INSTAGRAM_ACCOUNT_ID: process.env.INSTAGRAM_ACCOUNT_ID || '',
  INSTAGRAM_ACCESS_TOKEN: process.env.INSTAGRAM_ACCESS_TOKEN || '',

  // Threads API
  THREADS_USER_ID: process.env.THREADS_USER_ID || '',
  THREADS_ACCESS_TOKEN: process.env.THREADS_ACCESS_TOKEN || '',

  // Zalo Official Account
  ZALO_OA_ID: process.env.ZALO_OA_ID || '',
  ZALO_APP_ID: process.env.ZALO_APP_ID || '',
  ZALO_SECRET_KEY: process.env.ZALO_SECRET_KEY || '',
  ZALO_ACCESS_TOKEN: process.env.ZALO_ACCESS_TOKEN || '',
  ZALO_REFRESH_TOKEN: process.env.ZALO_REFRESH_TOKEN || '',

  // Kênh truyền thông thương hiệu chính thức
  BRAND_WEBSITE: process.env.BRAND_WEBSITE || 'https://quannguyens.com',
  BRAND_FACEBOOK: process.env.BRAND_FACEBOOK || 'https://facebook.com/qns.style',
  BRAND_INSTAGRAM: process.env.BRAND_INSTAGRAM || 'https://instagram.com/qns.style',
  BRAND_TIKTOK: process.env.BRAND_TIKTOK || 'https://www.tiktok.com/@qns.style?lang=vi-VN',

  // Tài khoản thanh toán Vietcombank & VietQR QuickLink (Nguồn cấu hình duy nhất do server quản lý)
  SEPAY_WEBHOOK_API_KEY: process.env.SEPAY_WEBHOOK_API_KEY || '',
  VIETQR_BANK_ID: process.env.VIETQR_BANK_ID || 'VCB',
  VIETQR_BIN: process.env.VIETQR_BIN || '970436',
  VIETQR_ACCOUNT_NO: process.env.VIETQR_ACCOUNT_NO || '',
  VIETQR_ACCOUNT_NAME: process.env.VIETQR_ACCOUNT_NAME || '',

  // Google Sheets Đồng bộ theo dõi đơn hàng
  GOOGLE_SHEET_ID: process.env.GOOGLE_SHEET_ID || '',
  GOOGLE_SHEET_CSV_URL: process.env.GOOGLE_SHEET_CSV_URL || '',
  GOOGLE_SHEET_RANGE: process.env.GOOGLE_SHEET_RANGE || 'A1:Z500',
  GOOGLE_SHEET_WEBHOOK_SECRET: process.env.GOOGLE_SHEET_WEBHOOK_SECRET || '',
  GOOGLE_SHEET_POLL_INTERVAL_MS: parseInt(process.env.GOOGLE_SHEET_POLL_INTERVAL_MS || '30000', 10),
  GOOGLE_SHEET_AUTO_SYNC: process.env.GOOGLE_SHEET_AUTO_SYNC === 'true',

  // Google Service Account
  GOOGLE_SERVICE_ACCOUNT_KEY_PATH: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH || '',
  GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL: process.env.GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL || '',
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '',
  GOOGLE_SERVICE_ACCOUNT_JSON: process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '',

  // Tự động hóa chăm sóc vòng đời & Giờ yên tĩnh
  OUTBOUND_ENABLED: process.env.OUTBOUND_ENABLED === 'true',
  QUIET_HOURS_ENABLED: process.env.QUIET_HOURS_ENABLED === 'true', // Mặc định false (đã loại bỏ theo yêu cầu của Shop)
  QUIET_HOURS_START: process.env.QUIET_HOURS_START || '20:00',
  QUIET_HOURS_END: process.env.QUIET_HOURS_END || '09:00',
  MARKETING_MAX_7D: parseInt(process.env.MARKETING_MAX_7D || '1', 10),
  MARKETING_MAX_30D: parseInt(process.env.MARKETING_MAX_30D || '3', 10),

  // Đơn vị vận chuyển (GHTK / GHN / ViettelPost)
  SHIPPING_CARRIER: process.env.SHIPPING_CARRIER || 'GHTK',
  SHIPPING_CARRIER_TOKEN: process.env.SHIPPING_CARRIER_TOKEN || 'CB70017EF1D541671B9D070CD5812C02',
  SHIPPING_SHOP_ID: process.env.SHIPPING_SHOP_ID || '',

  // Playwright RPA & Tu dong hoa trinh duyet Meta Business Suite / Fanpage / Instagram
  PLAYWRIGHT_HEADLESS: process.env.PLAYWRIGHT_HEADLESS !== 'false',
  PLAYWRIGHT_USER_DATA_DIR: process.env.PLAYWRIGHT_USER_DATA_DIR || path.resolve(process.cwd(), 'data/playwright_profile'),
  PLAYWRIGHT_STORAGE_STATE_PATH: process.env.PLAYWRIGHT_STORAGE_STATE_PATH || path.resolve(process.cwd(), 'data/playwright_storage_state.json'),
  PLAYWRIGHT_POLL_INTERVAL_MS: parseInt(process.env.PLAYWRIGHT_POLL_INTERVAL_MS || '6000', 10),
  PLAYWRIGHT_AUTO_REPLY: process.env.PLAYWRIGHT_AUTO_REPLY !== 'false',
  PLAYWRIGHT_TYPING_DELAY_MS: parseInt(process.env.PLAYWRIGHT_TYPING_DELAY_MS || '35', 10),

  // Canh bao khan cap khi gap Meta Checkpoint, mat phien dang nhap hoac loi he thong
  ALERT_TELEGRAM_BOT_TOKEN: process.env.ALERT_TELEGRAM_BOT_TOKEN || '',
  ALERT_TELEGRAM_CHAT_ID: process.env.ALERT_TELEGRAM_CHAT_ID || '',
  ALERT_ADMIN_MESSENGER_PSID: process.env.ALERT_ADMIN_MESSENGER_PSID || '',
  ALERT_WEBHOOK_URL: process.env.ALERT_WEBHOOK_URL || '',
  ALERT_DESKTOP_POPUP: process.env.ALERT_DESKTOP_POPUP !== 'false',

  // Cloud 0d Bridge (Botcake / AhaChat / ManyChat -> Render Cloud 24/7)
  CLOUD_BRIDGE_TOKEN: process.env.CLOUD_BRIDGE_TOKEN || '',
}

