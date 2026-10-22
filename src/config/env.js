import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs'

dotenv.config()

export const config = {
  NODE_ENV: process.env.NODE_ENV || 'production',
  PORT: parseInt(process.env.PORT || '3002', 10),
  TIMEZONE: process.env.TIMEZONE || 'Asia/Ho_Chi_Minh',
  CURRENCY: process.env.CURRENCY || 'VND',

  DEFAULT_TENANT_ID: process.env.DEFAULT_TENANT_ID || 'quannguyens_corp',
  DEFAULT_SHOP_ID: process.env.DEFAULT_SHOP_ID || 'quannguyens_pijama',

  DB_PATH: process.env.CSKH_DB_PATH || path.resolve(process.cwd(), 'data/cskh.db'),

  CONFIRMATION_SECRET: process.env.CSKH_CONFIRMATION_SECRET || 'dev_secret_confirmation_key_32bytes_min',
  ADMIN_SECRET: process.env.CSKH_ADMIN_SECRET || 'dev_admin_secret_key_32bytes_min',
  WEBHOOK_SECRET: process.env.CSKH_WEBHOOK_SECRET || 'dev_webhook_secret_key_32bytes_min',

  SHOP_API_BASE_URL: process.env.SHOP_API_BASE_URL || 'http://localhost:3001',
  SHOP_API_TOKEN: process.env.SHOP_API_TOKEN || '',

  // Trí tuệ nhân tạo Google Gemini (Gói Free Tier không thời hạn)
  LLM_PROVIDER: process.env.LLM_PROVIDER || 'gemini',
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  GROQ_API_KEY: process.env.GROQ_API_KEY || '',
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || '',

  // Meta (Facebook Page & Messenger)
  META_APP_ID: process.env.META_APP_ID || '',
  META_APP_SECRET: process.env.META_APP_SECRET || '',
  META_VERIFY_TOKEN: process.env.META_VERIFY_TOKEN || 'quannguyens_meta_verify_token_2026',
  META_PAGE_ID: process.env.META_PAGE_ID || '',
  META_PAGE_ACCESS_TOKEN: process.env.META_PAGE_ACCESS_TOKEN || '',

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

  // Tài khoản thanh toán Vietcombank & VietQR QuickLink (100% Free trọn đời)
  SEPAY_WEBHOOK_API_KEY: process.env.SEPAY_WEBHOOK_API_KEY || '',
  VIETQR_BANK_ID: process.env.VIETQR_BANK_ID || 'VCB',
  VIETQR_BIN: process.env.VIETQR_BIN || '970436',
  VIETQR_ACCOUNT_NO: process.env.VIETQR_ACCOUNT_NO || '1050773506',
  VIETQR_ACCOUNT_NAME: process.env.VIETQR_ACCOUNT_NAME || 'NGUYEN DUC QUAN',

  // Google Sheets Đồng bộ theo dõi đơn hàng (100% Free trọn đời)
  GOOGLE_SHEET_ID: process.env.GOOGLE_SHEET_ID || '',
  GOOGLE_SHEET_CSV_URL: process.env.GOOGLE_SHEET_CSV_URL || '',
  GOOGLE_SHEET_RANGE: process.env.GOOGLE_SHEET_RANGE || 'A1:Z500',
  GOOGLE_SHEET_WEBHOOK_SECRET: process.env.GOOGLE_SHEET_WEBHOOK_SECRET || 'quannguyens_sheets_secret_2026',
  GOOGLE_SHEET_POLL_INTERVAL_MS: parseInt(process.env.GOOGLE_SHEET_POLL_INTERVAL_MS || '30000', 10),
  GOOGLE_SHEET_AUTO_SYNC: process.env.GOOGLE_SHEET_AUTO_SYNC === 'true',

  // Google Service Account (Xác thực trực tiếp không cần chia sẻ công khai)
  GOOGLE_SERVICE_ACCOUNT_KEY_PATH: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH || '',
  GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL: process.env.GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL || '',
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '',
  GOOGLE_SERVICE_ACCOUNT_JSON: process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '',

  // Tự động hóa chăm sóc vòng đời & Giờ yên tĩnh
  OUTBOUND_ENABLED: process.env.OUTBOUND_ENABLED === 'true',
  QUIET_HOURS_START: process.env.QUIET_HOURS_START || '20:00',
  QUIET_HOURS_END: process.env.QUIET_HOURS_END || '09:00',
  MARKETING_MAX_7D: parseInt(process.env.MARKETING_MAX_7D || '1', 10),
  MARKETING_MAX_30D: parseInt(process.env.MARKETING_MAX_30D || '3', 10),
}
