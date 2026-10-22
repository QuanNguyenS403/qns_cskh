/**
 * GOOGLE SERVICE ACCOUNT CONNECTOR FOR GOOGLE SHEETS API V4
 * 
 * Xác thực bảo mật RS256 JWT thuần 100% bằng native node:crypto,
 * không phụ thuộc thư viện ngoài, không cần Google Sheet phải công khai.
 * 
 * Hỗ trợ nạp thông tin Service Account từ:
 * 1. File JSON credentials (ví dụ: credentials/google-service-account.json)
 * 2. Biến môi trường GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL & GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
 * 3. Chuỗi JSON toàn văn trong biến GOOGLE_SERVICE_ACCOUNT_JSON
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { config } from '../config/env.js'

export class GoogleServiceAccount {
  constructor() {
    this.cachedToken = null
    this.tokenExpiresAt = 0
  }

  /**
   * Nạp thông tin tài khoản dịch vụ (Client Email & Private Key)
   */
  getCredentials() {
    // 1. Kiểm tra từ file JSON chỉ định qua đường dẫn
    const possiblePaths = [
      config.GOOGLE_SERVICE_ACCOUNT_KEY_PATH,
      path.resolve(process.cwd(), 'credentials/google-service-account.json'),
      path.resolve(process.cwd(), 'google-service-account.json'),
      path.resolve(process.cwd(), 'service-account.json'),
    ].filter(Boolean)

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        try {
          const raw = fs.readFileSync(p, 'utf8')
          const json = JSON.parse(raw)
          if (json.client_email && json.private_key) {
            return {
              clientEmail: json.client_email,
              privateKey: json.private_key,
              projectId: json.project_id || '',
              source: `file:${p}`,
            }
          }
        } catch (e) {
          console.warn(`⚠️ [SERVICE ACCOUNT] Không đọc được file ${p}: ${e.message}`)
        }
      }
    }

    // 2. Kiểm tra chuỗi JSON trong biến môi trường
    if (config.GOOGLE_SERVICE_ACCOUNT_JSON) {
      try {
        let content = config.GOOGLE_SERVICE_ACCOUNT_JSON.trim()
        // Hỗ trợ Base64
        if (!content.startsWith('{')) {
          content = Buffer.from(content, 'base64').toString('utf8')
        }
        const json = JSON.parse(content)
        if (json.client_email && json.private_key) {
          return {
            clientEmail: json.client_email,
            privateKey: json.private_key,
            projectId: json.project_id || '',
            source: 'env:GOOGLE_SERVICE_ACCOUNT_JSON',
          }
        }
      } catch (e) {
        console.warn(`⚠️ [SERVICE ACCOUNT] Lỗi phân tích GOOGLE_SERVICE_ACCOUNT_JSON: ${e.message}`)
      }
    }

    // 3. Kiểm tra biến môi trường email + private key riêng lẻ
    if (config.GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL && config.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
      let key = config.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
      // Thay thế \n dạng text thành ký tự xuống dòng thực tế
      if (key.includes('\\n')) {
        key = key.replace(/\\n/g, '\n')
      }
      return {
        clientEmail: config.GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL.trim(),
        privateKey: key.trim(),
        projectId: '',
        source: 'env:GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL',
      }
    }

    return null
  }

  /**
   * Tạo JWT và lấy OAuth2 Access Token từ Google Identity API (RFC 7523)
   */
  async getAccessToken(fetchImpl = globalThis.fetch) {
    // Nếu token còn hạn ít nhất 2 phút, tái sử dụng
    if (this.cachedToken && this.tokenExpiresAt > Date.now() + 120000) {
      return this.cachedToken
    }

    const creds = this.getCredentials()
    if (!creds) {
      return null
    }

    const nowSec = Math.floor(Date.now() / 1000)
    const expSec = nowSec + 3600 // 1 giờ

    // Chuẩn bị Header & Claims chuẩn RS256
    const header = { alg: 'RS256', typ: 'JWT' }
    const claims = {
      iss: creds.clientEmail,
      scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
      aud: 'https://oauth2.googleapis.com/token',
      exp: expSec,
      iat: nowSec,
    }

    const base64UrlEncode = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url')
    const unsignedToken = `${base64UrlEncode(header)}.${base64UrlEncode(claims)}`

    // Ký bằng RSA-SHA256
    const signer = crypto.createSign('RSA-SHA256')
    signer.update(unsignedToken)
    let signature = ''
    try {
      signature = signer.sign(creds.privateKey, 'base64url')
    } catch (err) {
      console.error(`🚨 [SERVICE ACCOUNT KEY ERROR] Private Key không hợp lệ: ${err.message}`)
      return null
    }

    const assertion = `${unsignedToken}.${signature}`

    try {
      const response = await fetchImpl('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion,
        }),
      })

      if (!response.ok) {
        const errText = await response.text()
        console.error(`🚨 [GOOGLE OAUTH2 TOKEN ERROR HTTP ${response.status}]:`, errText)
        return null
      }

      const data = await response.json()
      this.cachedToken = data.access_token
      this.tokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000
      return this.cachedToken
    } catch (err) {
      console.error('🚨 [GOOGLE OAUTH2 FETCH EXCEPTION]:', err.message)
      return null
    }
  }

  /**
   * Đọc dữ liệu các dòng trên Google Sheet qua Google Sheets API v4
   */
  async fetchSheetRows({
    sheetId = config.GOOGLE_SHEET_ID,
    range = config.GOOGLE_SHEET_RANGE || 'A1:Z500',
    fetchImpl = globalThis.fetch,
  } = {}) {
    if (!sheetId) {
      return { success: false, reason: 'MISSING_SHEET_ID', error: 'Chưa cấu hình GOOGLE_SHEET_ID' }
    }

    const creds = this.getCredentials()
    if (!creds) {
      return { success: false, reason: 'NO_SERVICE_ACCOUNT', error: 'Chưa cấu hình Google Service Account credentials' }
    }

    const token = await this.getAccessToken(fetchImpl)
    if (!token) {
      return { success: false, reason: 'AUTH_FAILED', error: 'Không thể lấy Access Token từ Google Service Account' }
    }

    try {
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}`
      const response = await fetchImpl(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        const errorMessage = errorData.error?.message || `HTTP ${response.status}`

        if (response.status === 403) {
          console.warn(`\n⚠️ [GOOGLE SHEETS 403 PERMISSION DENIED]`)
          console.warn(`   Sheet ID: ${sheetId}`)
          console.warn(`   Google Sheet chưa được chia sẻ với Email Service Account:`)
          console.warn(`   👉 Email cần chia sẻ: ${creds.clientEmail}`)
          console.warn(`   👉 Hãy mở Google Sheet > Bấm "Chia sẻ" > Dán email trên vào và cấp quyền "Người xem"!\n`)
        } else if (response.status === 404) {
          console.warn(`⚠️ [GOOGLE SHEETS 404] Không tìm thấy Sheet ID ${sheetId}. Hãy kiểm tra lại ID trong file .env!`)
        }

        return {
          success: false,
          httpStatus: response.status,
          error: errorMessage,
          clientEmail: creds.clientEmail,
        }
      }

      const data = await response.json()
      const rawRows = data.values || []

      if (rawRows.length <= 1) {
        return { success: true, count: 0, rows: [], clientEmail: creds.clientEmail }
      }

      // Chuẩn hóa dòng tiêu đề (Dòng 0)
      const rawHeaders = rawRows[0]
      const headers = rawHeaders.map((h) =>
        String(h || '')
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .trim()
      )

      const parsedRows = []
      for (let i = 1; i < rawRows.length; i++) {
        const rowVals = rawRows[i]
        if (!rowVals || rowVals.length === 0) continue

        const rowObj = {}
        headers.forEach((header, idx) => {
          rowObj[header] = String(rowVals[idx] || '').trim()
        })
        parsedRows.push({ ...rowObj, _raw: rowVals, _rowIndex: i + 1 })
      }

      return {
        success: true,
        count: parsedRows.length,
        rows: parsedRows,
        clientEmail: creds.clientEmail,
      }
    } catch (err) {
      console.error('🚨 [GOOGLE SHEETS API EXCEPTION]:', err.message)
      return { success: false, error: err.message, clientEmail: creds.clientEmail }
    }
  }
}

export const googleServiceAccount = new GoogleServiceAccount()
