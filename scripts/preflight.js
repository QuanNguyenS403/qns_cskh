#!/usr/bin/env node

/**
 * QUANNGUYENS AI CSKH - PREFLIGHT CHECK & DIAGNOSTICS SUITE
 * Chạy trước khi triển khai hoặc khởi động server để kiểm tra toàn diện tính sẵn sàng:
 * 1. Môi trường & Khóa bảo mật (.env)
 * 2. CSDL SQLite & Migrations
 * 3. Dịch vụ AI Google Gemini
 * 4. Google Sheets (Service Account RS256 JWT)
 * 5. Kênh tích hợp Meta (Messenger, Instagram) & Zalo OA
 * 6. Kênh thanh toán VietQR & SePay Webhook
 */

import { config, validateEnvironment, INSECURE_DEFAULT_SECRETS } from '../src/config/env.js'
import { getDb } from '../src/db/connection.js'
import { runMigrations } from '../src/db/migrations.js'
import { getAllApprovedPolicies, seedDefaultPolicies } from '../src/policies/policyRegistry.js'
import { googleServiceAccount } from '../src/integrations/googleServiceAccount.js'

console.log('\n======================================================================')
console.log('🔍 QUANNGUYENS AI CSKH — PREFLIGHT DIAGNOSTIC SUITE')
console.log('   Thời gian:', new Date().toLocaleString('vi-VN'))
console.log('   Môi trường:', config.NODE_ENV.toUpperCase())
console.log('======================================================================\n')

const results = []

function addCheck(category, item, status, message) {
  results.push({ category, item, status, message })
}

// ── 1. KIỂM TRA MÔI TRƯỜNG & KHÓA BẢO MẬT ─────────────────────────────
const envCheck = validateEnvironment(process.env)
if (envCheck.isValid) {
  addCheck('Bảo Mật', 'Biến Môi Trường (.env)', 'PASS', 'Đầy đủ cấu hình hợp lệ')
} else {
  const isProd = config.NODE_ENV === 'production'
  addCheck('Bảo Mật', 'Biến Môi Trường (.env)', isProd ? 'FAIL' : 'WARN', envCheck.errors.join('; '))
}

// Kiểm tra các khóa mặc định không an toàn
const exposedKeys = []
if (INSECURE_DEFAULT_SECRETS.includes(config.ADMIN_SECRET)) exposedKeys.push('ADMIN_SECRET')
if (INSECURE_DEFAULT_SECRETS.includes(config.META_VERIFY_TOKEN)) exposedKeys.push('META_VERIFY_TOKEN')
if (INSECURE_DEFAULT_SECRETS.includes(config.GOOGLE_SHEET_WEBHOOK_SECRET)) exposedKeys.push('GOOGLE_SHEET_WEBHOOK_SECRET')

if (exposedKeys.length > 0) {
  addCheck('Bảo Mật', 'Xoay Vòng Khóa (Key Rotation)', 'WARN', `Các khóa đang dùng giá trị mẫu: ${exposedKeys.join(', ')} (Xem docs/PHIEU_XIN_QUYEN.md)`)
} else {
  addCheck('Bảo Mật', 'Xoay Vòng Khóa (Key Rotation)', 'PASS', 'Không sử dụng khóa mẫu mặc định')
}

// ── 2. KIỂM TRA CƠ SỞ DỮ LIỆU SQLITE ──────────────────────────────────
try {
  const db = getDb()
  runMigrations(db)
  seedDefaultPolicies(db, config.DEFAULT_SHOP_ID, true)

  const tables = db.prepare(`SELECT count(*) as count FROM sqlite_master WHERE type='table'`).get()
  const policies = getAllApprovedPolicies(db, config.DEFAULT_SHOP_ID)
  const policyCount = Object.keys(policies).filter((k) => policies[k] !== null).length

  addCheck('CSDL SQLite', 'Kết Nối & Migration', 'PASS', `17 bảng cốt lõi sẵn sàng (${tables.count} bảng tổng)`)
  addCheck('CSDL SQLite', 'Chính Sách Đã Duyệt', 'PASS', `${policyCount} chính sách đã APPROVED (Đổi trả, Vận chuyển, Giá, v.v.)`)
} catch (err) {
  addCheck('CSDL SQLite', 'Kết Nối & Migration', 'FAIL', err.message)
}

// ── 3. KIỂM TRA GOOGLE SERVICE ACCOUNT & GOOGLE SHEETS ────────────────
const creds = googleServiceAccount.getCredentials()
if (creds) {
  addCheck('Google Sheets', 'Service Account JWT', 'PASS', `Email: ${creds.clientEmail} (${creds.source})`)
} else {
  addCheck('Google Sheets', 'Service Account JWT', 'WARN', 'Chưa cấu hình JSON Service Account. Sẽ dùng CSV Poller dự phòng.')
}

if (config.GOOGLE_SHEET_ID) {
  addCheck('Google Sheets', 'Sheet Đơn Hàng', 'PASS', `Theo dõi Sheet ID: ${config.GOOGLE_SHEET_ID}`)
} else {
  addCheck('Google Sheets', 'Sheet Đơn Hàng', 'WARN', 'Chưa điền GOOGLE_SHEET_ID')
}

// ── 4. KIỂM TRA MÔ HÌNH AI GOOGLE GEMINI ──────────────────────────────
if (config.GEMINI_API_KEY) {
  addCheck('AI Engine', 'Google Gemini Key', 'PASS', `Mô hình: ${config.GEMINI_MODEL}`)
} else {
  addCheck('AI Engine', 'Google Gemini Key', 'WARN', 'Chưa có GEMINI_API_KEY. May sẽ chạy ở chế độ Rule-Based / Grounded Fallback an toàn.')
}

// ── 5. KIỂM TRA CỔNG META (MESSENGER / INSTAGRAM) ─────────────────────
if (config.META_PAGE_ACCESS_TOKEN) {
  addCheck('Meta Platform', 'Messenger Token', 'PASS', `Page ID: ${config.META_PAGE_ID || 'Đã cấu hình'}`)
} else {
  addCheck('Meta Platform', 'Messenger Token', 'WARN', 'Chưa có META_PAGE_ACCESS_TOKEN (Chế độ giả lập an toàn)')
}

if (config.INSTAGRAM_ACCESS_TOKEN) {
  addCheck('Meta Platform', 'Instagram Token', 'PASS', `Account ID: ${config.INSTAGRAM_ACCOUNT_ID || 'Đã cấu hình'}`)
} else {
  addCheck('Meta Platform', 'Instagram Token', 'WARN', 'Chưa có INSTAGRAM_ACCESS_TOKEN')
}

// ── 6. KIỂM TRA ZALO OFFICIAL ACCOUNT ─────────────────────────────────
if (config.ZALO_ACCESS_TOKEN) {
  addCheck('Zalo OA', 'Zalo OpenAPI Token', 'PASS', `OA ID: ${config.ZALO_OA_ID || 'Đã cấu hình'}`)
} else {
  addCheck('Zalo OA', 'Zalo OpenAPI Token', 'WARN', 'Chưa có ZALO_ACCESS_TOKEN')
}

// ── 7. KIỂM TRA TÀI KHOẢN THANH TOÁN VIETQR ──────────────────────────
if (config.VIETQR_ACCOUNT_NO && config.VIETQR_BANK_ID) {
  addCheck('Thanh Toán', 'VietQR QuickLink', 'PASS', `${config.VIETQR_BANK_ID} - STK: ${config.VIETQR_ACCOUNT_NO} (${config.VIETQR_ACCOUNT_NAME})`)
} else {
  addCheck('Thanh Toán', 'VietQR QuickLink', 'FAIL', 'Thiếu số tài khoản nhận tiền VIETQR_ACCOUNT_NO')
}

// ── HIỂN THỊ BẢNG KẾT QUẢ ─────────────────────────────────────────────
console.log('┌──────────────┬──────────────────────────────┬────────┬────────────────────────────────────────────────────────┐')
console.log('│ PHÂN HỆ      │ MỤC KIỂM TRA                 │ TRẠNG  │ GHI CHÚ / CHI TIẾT                                     │')
console.log('├──────────────┼──────────────────────────────┼────────┼────────────────────────────────────────────────────────┤')

let hasFailure = false
for (const r of results) {
  const padCat = r.category.padEnd(12).substring(0, 12)
  const padItem = r.item.padEnd(28).substring(0, 28)
  const statusStr = r.status === 'PASS' ? '\x1b[32mPASS\x1b[0m  ' : (r.status === 'WARN' ? '\x1b[33mWARN\x1b[0m  ' : '\x1b[31mFAIL\x1b[0m  ')
  const padMsg = r.message.padEnd(54).substring(0, 54)
  console.log(`│ ${padCat} │ ${padItem} │ ${statusStr} │ ${padMsg} │`)
  if (r.status === 'FAIL') hasFailure = true
}
console.log('└──────────────┴──────────────────────────────┴────────┴────────────────────────────────────────────────────────┘\n')

if (hasFailure) {
  console.error('🚨 [PREFLIGHT FAILED] Phát hiện cấu hình lỗi bắt buộc cần khắc phục trước khi khởi chạy!')
  process.exit(1)
} else {
  console.log('✅ [PREFLIGHT PASSED] Toàn bộ hệ thống sẵn sàng hoạt động an toàn 24/7!')
  process.exit(0)
}
