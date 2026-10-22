# HƯỚNG DẪN TRIỂN KHAI HỆ THỐNG CSKH LÊN RENDER (FREE PLAN)

Hệ thống AI CSKH 24/7 QuanNguyenS cấu hình cho **Render Free Plan** (miễn phí hoàn toàn), kết hợp cron job để giữ service luôn hoạt động 24/7.

---

## 1. KIẾN TRÚC TỔNG QUAN

```
GitHub Repository
├── render.yaml          → Render đọc để tự tạo Web Service (Free)
└── .github/workflows/
    └── keep-alive.yml   → GitHub Actions ping /api/ping mỗi 10 phút (FREE)

Render Free Web Service
├── Runtime: Node.js 22.12.0 (ESM)
├── Build: npm ci
├── Start: node src/server.js
├── Health: GET /livez → 200
├── Ping:   GET /api/ping → {pong: true, uptime: ...}
└── SQLite: /opt/render/project/src/data/cskh.db (ephemeral)
```

### ⚠️ Về dữ liệu SQLite trên Free Plan

| Tình huống | Kết quả |
|-----------|---------|
| Service đang chạy bình thường | ✅ Dữ liệu được bảo toàn |
| Cron job ping mỗi 10 phút | ✅ Service không ngủ, dữ liệu không mất |
| Render **tự restart** (hiếm, ~1 lần/tuần) | ⚠️ Dữ liệu bị reset |
| Bạn push code mới / redeploy | ⚠️ Dữ liệu bị reset |

> **Phù hợp cho:** MVP, demo, testing, chatbot nhắn tin thực tế (hội thoại tạm thời).  
> **Nếu cần dữ liệu đơn hàng bền vững:** Nâng lên Render Starter + Persistent Disk (~$7.25/tháng).

---

## 2. CÁC BƯỚC DEPLOY

### Bước 1 — Push code lên GitHub

```bash
git add .
git commit -m "feat: render free plan + github actions keep-alive cron"
git push origin main
```

### Bước 2 — Deploy lên Render qua Blueprint

1. Vào [dashboard.render.com](https://dashboard.render.com)
2. **New +** → **Blueprint** → chọn repository GitHub
3. Render đọc `render.yaml`, tự tạo Web Service Free
4. Render tự sinh 3 secret: `CSKH_CONFIRMATION_SECRET`, `CSKH_ADMIN_SECRET`, `CSKH_WEBHOOK_SECRET`
5. Bấm **Apply**

### Bước 3 — Điền các Secret nhạy cảm trên Render Dashboard

Tab **Environment** → thêm từng biến:

| Biến | Mô tả | Bắt buộc? |
|------|--------|-----------|
| `GEMINI_API_KEY` | API key Google Gemini (lấy tại aistudio.google.com) | ✅ Có |
| `META_APP_ID` | Facebook App ID | Khi dùng Messenger |
| `META_APP_SECRET` | Facebook App Secret | Khi dùng Messenger |
| `META_PAGE_ID` | Facebook Page ID | Khi dùng Messenger |
| `META_PAGE_ACCESS_TOKEN` | Token gửi tin Messenger | Khi dùng Messenger |
| `META_VERIFY_TOKEN` | Token xác thực webhook Meta | Khi dùng Messenger |
| `INSTAGRAM_ACCOUNT_ID` | Instagram Account ID | Khi dùng Instagram DM |
| `INSTAGRAM_ACCESS_TOKEN` | Token gửi tin Instagram | Khi dùng Instagram DM |
| `THREADS_USER_ID` | Threads User ID | Khi dùng Threads |
| `THREADS_ACCESS_TOKEN` | Token Threads | Khi dùng Threads |
| `ZALO_OA_ID` | Zalo OA ID | Khi dùng Zalo |
| `ZALO_APP_ID` | Zalo App ID | Khi dùng Zalo |
| `ZALO_SECRET_KEY` | Zalo Secret Key | Khi dùng Zalo |
| `ZALO_ACCESS_TOKEN` | Zalo Access Token | Khi dùng Zalo |
| `ZALO_REFRESH_TOKEN` | Zalo Refresh Token | Khi dùng Zalo |
| `SEPAY_WEBHOOK_API_KEY` | API key xác thực SePay | Khi dùng SePay |
| `GOOGLE_SHEET_ID` | ID Google Spreadsheet | Khi dùng Sheets |
| `GOOGLE_SHEET_WEBHOOK_SECRET` | Secret cho Sheets webhook | Khi dùng Sheets |
| `GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL` | Email Service Account | Khi dùng Sheets |
| `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | Private Key RSA (thay `\n` cho xuống dòng) | Khi dùng Sheets |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | JSON Base64 đầy đủ (ưu tiên hơn 2 biến trên) | Khi dùng Sheets |

### Bước 4 — Cấu hình GitHub Actions Keep-Alive

Sau khi deploy, lấy URL service Render (VD: `https://quannguyens-ai-cskh.onrender.com`):

1. Trên GitHub repo → **Settings** → **Secrets and variables** → **Actions**
2. Bấm **New repository secret**
3. Tên: `RENDER_SERVICE_URL`
4. Giá trị: `https://quannguyens-ai-cskh.onrender.com` *(không có dấu `/` cuối)*
5. Bấm **Add secret**

GitHub Actions sẽ tự động ping mỗi 10 phút → service không bao giờ ngủ.

### Bước 5 — Kiểm tra sau khi deploy

```bash
# Health check
curl https://quannguyens-ai-cskh.onrender.com/livez
# → {"status":"alive","time":"..."}

# Ping endpoint (cho cron job)
curl https://quannguyens-ai-cskh.onrender.com/api/ping
# → {"pong":true,"uptime":123,"time":"..."}

# DB + Readiness
curl https://quannguyens-ai-cskh.onrender.com/readyz
# → {"status":"ready","db":"connected","time":"..."}

# Test May chatbot
curl -X POST https://quannguyens-ai-cskh.onrender.com/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Cho xem giá set pijama Daybreak"}'
```

---

## 3. PHƯƠNG ÁN CRON JOB THAY THẾ (nếu không dùng GitHub Actions)

### Phương án A — cron-job.org (Miễn phí, đơn giản nhất)

1. Đăng ký tại [cron-job.org](https://cron-job.org)
2. **Create Cronjob** → URL: `https://quannguyens-ai-cskh.onrender.com/api/ping`
3. Execution schedule: **Every 10 minutes**
4. Request method: **GET**
5. Bấm **Create**

### Phương án B — UptimeRobot (Miễn phí, có dashboard đẹp)

1. Đăng ký tại [uptimerobot.com](https://uptimerobot.com)
2. **Add New Monitor** → Type: **HTTP(s)**
3. URL: `https://quannguyens-ai-cskh.onrender.com/livez`
4. Monitoring Interval: **5 minutes**
5. Bấm **Create Monitor**

> **Bonus:** UptimeRobot gửi alert email khi service down!

---

## 4. WEBHOOK URLS (Cấu hình trên Meta/Zalo/SePay)

| Kênh | Webhook URL |
|------|------------|
| Meta (Messenger/Instagram/Threads) | `https://quannguyens-ai-cskh.onrender.com/api/webhook/meta` |
| Zalo OA | `https://quannguyens-ai-cskh.onrender.com/api/webhook/zalo` |
| SePay thanh toán | `https://quannguyens-ai-cskh.onrender.com/api/webhook/sepay` |
| Google Sheets (GAS) | `https://quannguyens-ai-cskh.onrender.com/api/webhook/google-sheets` |
| Meta Verify Token | Giá trị `META_VERIFY_TOKEN` đã cấu hình |

---

## 5. XỬ LÝ LỖI THƯỜNG GẶP

### Service trả về 502/503 lần đầu sau khi deploy
→ Service đang warm up. Chờ 30-60 giây rồi thử lại.

### `/readyz` trả về `not_ready`
→ DB chưa khởi tạo. Kiểm tra logs Render: service phải thấy `✅ [CSKH DB] Cơ sở dữ liệu, Migration & Chính sách đã sẵn sàng.`

### Meta Webhook trả về 403 khi verify
→ Kiểm tra `META_VERIFY_TOKEN` trên Render Dashboard khớp với giá trị đã điền trên Meta Developer Portal.

### Google Sheets 403 Permission Denied
→ Chưa chia sẻ sheet với email Service Account. Mở Google Sheet → **Chia sẻ** → dán email Service Account → quyền **Người xem**.

### Dữ liệu bị mất sau vài ngày
→ Render tự restart service. Đây là giới hạn của Free Plan. Xem xét nâng Starter Plan nếu cần bền vững.
