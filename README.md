# QUANNGUYENS — AI AGENT CSKH & HỆ THỐNG CHĂM SÓC VÒNG ĐỜI KHÁCH HÀNG 24/7

**Thương hiệu:** QuanNguyenS · [quannguyens.com](https://quannguyens.com/)  
**Phong cách:** Pyjama & Loungewear European Casual  
**Hệ thống:** AI CSKH Tự Động Hóa 24/7 (Trợ lý May) & Omnichannel Gateway  
**Căn cứ:** `QuanNguyenS_AI_CSKH_Master_Blueprint_v2_2026-10-22.md`

---

## 1. TỔNG QUAN HỆ THỐNG

Dự án cung cấp một nền tảng CSKH tự động hóa 24/7 đa kênh hoàn chỉnh, độc lập và bảo mật cao cho thương hiệu QuanNguyenS:
- **Trợ lý AI May:** Tự nhiên, ấm áp, trung thực, minh bạch danh tính AI ngay từ đầu, bám sát toàn bộ vòng đời khách hàng (Khám phá → Chọn size → Mua → Thanh toán → Giao nhận → Hậu mãi → Mua lại).
- **Nguyên tắc "Không bịa" & Căn cứ nghiệp vụ:** Giá tiền, tồn kho, thời gian giao hàng, quyền đổi trả được quyết định bởi CSDL và dịch vụ máy chủ, LLM không tự tính tiền hoặc tự bịa chính sách.
- **Bảo mật & Ranh giới tin cậy (Anti-Prompt-Injection):** Kiểm soát quyền từng đối tượng (chống IDOR), token xác nhận gắn hash payload + TTL 5 phút, khóa chống trùng (Idempotency), audit log che PII và bí mật.
- **Cổng đa kênh (Omnichannel):** Hỗ trợ Facebook Messenger, Instagram Direct, Threads API, Zalo Official Account (ZBS Template) và Web Chat. Cổng `can_send` runtime kiểm tra chặt chẽ cửa sổ 24h, giờ nghỉ ban đêm, chặn tag đã ngừng của Meta và chặn gửi tiếp thị khi khách có khiếu nại đang mở.
- **Khả năng phục hồi bền vững:** Lưu trữ giao dịch SQLite WAL mode, outbox pattern, job leasing chống race condition, chịu lỗi sập nguồn/restart giữa chừng mà không mất đơn hay trùng tiền.

---

## 2. KIẾN TRÚC MÃ NGUỒN (`D:\CSKH`)

```text
D:\CSKH\
├── package.json               # Cấu hình dự án & dependencies (Express, Helmet, Cors, Zod, Dotenv)
├── .env.example               # Mẫu cấu hình môi trường chuẩn
├── .gitignore                 # Bỏ qua node_modules, data/*.db, .env (Bảo mật B19)
├── README.md                  # Tài liệu hướng dẫn & kiến trúc
├── data\                      # Thư mục lưu trữ database SQLite (WAL mode)
├── docs\
│   └── HUONG_DAN_KET_NOI_DA_KENH.md  # Hướng dẫn kết nối Facebook, Instagram, Threads, Zalo
├── src\
│   ├── config\
│   │   ├── env.js             # Quản lý cấu hình & biến môi trường
│   │   └── killSwitch.js      # Công tắc khẩn cấp 3 cấp (Global, Action, Channel)
│   ├── db\
│   │   ├── connection.js      # Kết nối SQLite hiệu năng cao qua node:sqlite
│   │   └── migrations.js      # Migration hai chiều (Up/Down) cho 17 bảng dữ liệu
│   ├── security\
│   │   ├── auditLogger.js     # Audit log tự động che PII, email, SĐT, secret
│   │   ├── tokenService.js    # Confirmation Token HMAC-SHA256, hash payload, TTL 5m, single-use
│   │   └── rateLimiter.js     # Bộ giới hạn tần suất yêu cầu chống DDoS
│   ├── queue\
│   │   ├── outbox.js          # Outbox pattern lưu tin nhắn bền vững
│   │   └── scheduler.js       # Scheduler với Lease Token chống race condition
│   ├── events\
│   │   └── eventGateway.js    # Cổng sự kiện: chữ ký timing-safe & chống trùng sự kiện
│   ├── channels\              # Bộ điều hợp đa kênh & Cổng can_send runtime
│   │   ├── canSend.js         # Kiểm tra quyền gửi: 24h window, suppression, opt-out, quiet hours
│   │   ├── metaWebhook.js     # Cổng webhook hợp nhất cho Messenger, Instagram, Threads
│   │   ├── messengerAdapter.js# Adapter Facebook Messenger (Graph API v21.0)
│   │   ├── instagramAdapter.js# Adapter Instagram Direct Messaging
│   │   ├── threadsAdapter.js  # Adapter Threads API
│   │   └── zaloAdapter.js     # Adapter Zalo OA ZBS Template Messages
│   └── server.js              # Express Server CSKH Action Gateway (Port 3002)
└── tests\
    └── phase0\
        ├── databaseMigrations.test.js   # Test migration 17 bảng (Up, Down, Idempotent)
        ├── paymentDeduplication.test.js # Test Gate T13 (Webhook lặp chỉ ghi 1 lần)
        ├── durableRecovery.test.js      # Test Gate T37 & T10 (Restart khôi phục, timeout đối soát)
        ├── killSwitch.test.js           # Test Kill switch 3 cấp
        ├── outboxScheduler.test.js      # Test Outbox, scheduler lease, token integrity
        ├── multiChannel.test.js         # Test can_send runtime & Meta webhook
        └── serverEndpoints.test.js      # Test API health, readiness, webhook verification
```

---

## 3. HƯỚNG DẪN KHỞI CHẠY & KIỂM THỬ

### Cài đặt dependencies:
```bash
npm install
```

### Chạy toàn bộ Test Suite (100% Passed):
```bash
npm test
```

### Khởi chạy Server Gateway:
```bash
npm start
```
Server sẽ chạy tại `http://localhost:3002`:
- **Health Check:** `http://localhost:3002/api/health`
- **Liveness:** `http://localhost:3002/livez`
- **Readiness:** `http://localhost:3002/readyz`
- **Meta Webhook (Messenger/IG/Threads):** `http://localhost:3002/api/webhook/meta`
- **Payment Webhook (SePay):** `http://localhost:3002/api/webhook/sepay`
