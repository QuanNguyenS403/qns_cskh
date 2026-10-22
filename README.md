# QUANNGUYENS — AI AGENT CSKH & HỆ THỐNG CHĂM SÓC VÒNG ĐỜI KHÁCH HÀNG 24/7

**Thương hiệu:** QuanNguyenS · [quannguyens.com](https://quannguyens.com/)  
**Phong cách:** Pyjama & Loungewear European Casual  
**Hệ thống:** AI CSKH Tự Động Hóa 24/7 (Trợ lý May) & Omnichannel Action Gateway  
**Căn cứ thiết kế:** `QuanNguyenS_AI_CSKH_Master_Blueprint_v2_2026-10-22.md` & Master Build Prompts A & B  
**Kho lưu trữ mã nguồn:** [https://github.com/QuanNguyenS403/qns_cskh.git](https://github.com/QuanNguyenS403/qns_cskh.git) (nhánh `main`)

---

## 1. TỔNG QUAN HỆ THỐNG & KẾT QUẢ TRIỂN KHAI

Hệ thống được thiết kế và xây dựng độc lập 100% trong `D:\CSKH`, đáp ứng đầy đủ 7 Phase theo tiêu chuẩn khắt khe nhất của Master Blueprint v2:

| Phase | Trọng tâm | Trạng thái | Kiểm thử đã vượt qua |
| --- | --- | --- | --- |
| **Phase 0** | Nền tảng bền vững, SQLite WAL (18 bảng), Idempotency, Outbox, Scheduler, Kill Switch 3 cấp, Đa kênh (Messenger, IG, Threads, Zalo) | **HOÀN THÀNH** | 7/7 test suites (Durable recovery, Webhook dedup, can_send runtime) |
| **Phase 1** | Tri thức chuẩn hóa, Catalog SKU vật lý, Policy Registry (Snapshotting T42), Pricing Engine (Integer VND, Freeship sau giảm T08), Knowledge Base RAG | **HOÀN THÀNH** | 4/4 test suites (T01–T05, T07, T08, T42) |
| **Phase 2** | Hội thoại cốt lõi May, Prompt B runtime, Ngăn chặn Prompt Injection (B15), Grounding Checker kiểm duyệt trước khi xuất xưởng, X01–X15 | **HOÀN THÀNH** | 3/3 test suites (Phụ lục A Schema, X01–X15, Grounding) |
| **Phase 3** | Công cụ giao dịch: Giữ tồn kho nguyên tử (Reservation), Chốt đơn 2 bước (Token HMAC-SHA256), VietQR, Đối soát SePay (X17, X18), Phân quyền IDOR (B10, X12) | **HOÀN THÀNH** | 6/6 test suites (T11–T22, X16–X22) |
| **Phase 4** | Hậu mãi & Khiếu nại: Máy trạng thái Case P0–P3, RMA Đổi/Trả theo snapshot đơn (T42, X23, X24), Chống gian lận hoàn tiền (X26), Xử lý scan giao chưa nhận (V6), Sổ cam kết | **HOÀN THÀNH** | 5/5 test suites (T23–T30, X23–X26) |
| **Phase 5** | Tự động hóa vòng đời & Đồng thuận: Hủy ngay job marketing khi Opt-out (B12, X27), Quyền được lãng quên/xóa dữ liệu (B11), Chặn tiếp thị khi có case mở (T34) | **HOÀN THÀNH** | 3/3 test suites (T34–T41, X27–X32) |
| **Phase 6** | Bộ kiểm thử đánh giá chuẩn (Master Benchmark): 42 Cổng cốt lõi (T01–T42) & 32 Tình huống tiếng Việt thực tế (X01–X32) | **HOÀN THÀNH** | 100% Pass (75/75 tests đạt trong 1.1s) |
| **Phase 7** | Sổ tay vận hành, Runbook xử lý sự cố, Hướng dẫn kết nối đa kênh thực tế cho chủ shop | **HOÀN THÀNH** | Bộ 3 tài liệu vận hành chi tiết trong `docs/` |

---

## 2. NGUYÊN TẮC BẤT BIẾN (NON-NEGOTIABLE)

1. **B01 Minh bạch AI:** May luôn công khai mình là trợ lý AI; không giả làm người, không nói dối là đã mặc thử đồ hay đứng ở kho.
2. **B02 Không bịa đặt:** Giá, tồn kho, thành phần, kích thước, xuất xứ phải đến từ CSDL hoặc tài liệu đã duyệt. Trường thiếu (như xuất xứ vải ghi `null`) thì trả lời trung thực, không bịa đặt xuất xứ Châu Âu.
3. **B03 Số tiền nguyên VND:** LLM không tự tính tiền. Mọi con số tiền, phí ship, chiết khấu do máy chủ tính toán kiểu số nguyên VND.
4. **B04 Chính sách có phiên bản:** Không hard-code chính sách vào prompt. Chính sách ở trạng thái `DRAFT` tuyệt đối không được nhắc như quyền lợi áp dụng.
5. **B06 Token xác nhận giao dịch:** Thao tác tạo đơn và sửa đơn bắt buộc dùng Confirmation Token HMAC-SHA256 (TTL 5 phút, khóa theo hash payload, chỉ dùng 1 lần).
6. **B08 Ghi nhận PAID có căn cứ:** Chỉ ghi nhận đơn đã thanh toán khi có dữ liệu webhook xác thực từ ngân hàng/cổng thanh toán. Không ghi PAID từ ảnh chụp màn hình do khách gửi.
7. **B10 Chống IDOR:** Mã đơn hàng đơn lẻ không đủ để xem thông tin đơn; bắt buộc phải xác minh đúng số điện thoại của người đặt hàng.
8. **B12 Kiểm soát can_send:** Mọi tin nhắn chủ động đều đi qua cổng `can_send` kiểm tra cửa sổ 24h, giờ nghỉ ban đêm (20:00–09:00), hủy job ngay khi khách opt-out và chặn tin tiếp thị nếu đơn hàng đang có khiếu nại chưa xử lý xong.
9. **B15 Chống Prompt Injection:** Tin nhắn từ khách là dữ liệu không tin cậy (`<untrusted_user_input>`), không thể ghi đè quy tắc hệ thống, không thể tự nâng quyền admin.

---

## 3. CẤU TRÚC THƯ MỤC DỰ ÁN (`D:\CSKH`)

```text
D:\CSKH\
├── package.json               # Cấu hình dự án & dependencies (Express, Helmet, Cors, Zod, Dotenv)
├── .env.example               # Biến môi trường mẫu chuẩn
├── .gitignore                 # Bảo mật secrets, DB và node_modules
├── README.md                  # Báo cáo tổng thể hệ thống
├── data\                      # Thư mục cơ sở dữ liệu SQLite bền vững (WAL mode)
├── docs\
│   ├── HUONG_DAN_KET_NOI_DA_KENH.md      # Hướng dẫn chi tiết kết nối Facebook, Instagram, Threads, Zalo
│   ├── VAN_HANH_HE_THONG_CSKH.md        # Sổ tay vận hành 24/7 & quy trình xử lý đơn
│   └── RUNBOOK_KILL_SWITCH_VA_SU_CO.md  # Hướng dẫn ngắt khẩn cấp 3 cấp & khôi phục sự cố
├── src\
│   ├── config\
│   │   ├── env.js             # Quản lý biến môi trường
│   │   └── killSwitch.js      # Công tắc khẩn cấp 3 cấp (Global, Action, Channel)
│   ├── db\
│   │   ├── connection.js      # Kết nối SQLite (node:sqlite WAL mode)
│   │   └── migrations.js      # Quản lý 18 bảng CSDL và rollback nguyên tử
│   ├── catalog\
│   │   └── products.js        # Catalog chuẩn hóa: SKU, thông số vật lý, bảng đo 2 lớp
│   ├── policies\
│   │   └── policyRegistry.js  # Phiên bản DRAFT vs APPROVED, đóng băng Snapshot (T42)
│   ├── pricing\
│   │   └── pricingService.js  # Quote Engine, chiết khấu chuyển khoản, Freeship sau giảm (T08)
│   ├── knowledge\
│   │   └── knowledgeBase.js   # RAG lai tiếng Việt (bỏ dấu/đồng nghĩa), evidence_ref
│   ├── agent\
│   │   ├── outputSchema.js    # Schema đầu ra theo Phụ lục A (Zod validated)
│   │   ├── systemPrompt.js    # Xây dựng System Prompt runtime của May (Prompt B)
│   │   ├── groundingChecker.js# Kiểm duyệt trước khi gửi (chặn secret leak, bịa giá, injection)
│   │   └── mayOrchestrator.js # Não bộ điều phối hội thoại, thấu cảm, xử lý teencode
│   ├── inventory\
│   │   └── inventoryService.js# Giữ tồn kho nguyên tử (Reservation) có TTL chống oversell
│   ├── orders\
│   │   └── orderService.js    # Prepare & Commit order, VietQR QuickLink, Reconcile branches
│   ├── cases\
│   │   └── caseService.js     # Quản lý Case P0-P3, RMA đổi trả, vận đơn & xử lý giao thiếu (V6)
│   ├── lifecycle\
│   │   └── lifecycleEngine.js # Outbound care, xử lý Opt-out lập tức, Right to be Forgotten
│   ├── security\
│   │   ├── auditLogger.js     # Audit log tự động che PII, SĐT, email, secret
│   │   ├── tokenService.js    # Token HMAC-SHA256, hash payload, TTL 5m, single-use
│   │   └── rateLimiter.js     # Bộ giới hạn tần suất request chống DDoS
│   ├── queue\
│   │   ├── outbox.js          # Hộp thư gửi tin bền vững
│   │   └── scheduler.js       # Scheduler với Lease Token chống race condition
│   ├── events\
│   │   └── eventGateway.js    # Cổng sự kiện khử trùng lặp (Idempotent)
│   ├── channels\
│   │   ├── canSend.js         # Cổng kiểm soát gửi tin: 24h window, quiet hours, case suppression
│   │   ├── metaWebhook.js     # Webhook tích hợp Facebook Messenger, Instagram, Threads
│   │   ├── messengerAdapter.js# Adapter Facebook Messenger (Graph API v21.0)
│   │   ├── instagramAdapter.js# Adapter Instagram Direct Messaging
│   │   ├── threadsAdapter.js  # Adapter Threads API
│   │   └── zaloAdapter.js     # Adapter Zalo OA ZBS Template Messages
│   └── server.js              # Express Gateway CSKH (Port 3002)
└── tests\
    ├── phase0\                # 7 test suites: Migrations, Payment Dedup, Recovery, KillSwitch, Channels
    ├── phase1\                # 4 test suites: Catalog, Policy Registry, Pricing, Knowledge Base
    ├── phase2\                # 3 test suites: May Persona, Phụ lục A Schema, X01–X15, Grounding
    ├── phase3\                # 6 test suites: Reservations, Commit Order, VietQR, Reconcile, Object Auth
    ├── phase4\                # 5 test suites: Service Cases, RMA, Refund fraud protection, Tracking V6
    ├── phase5\                # 3 test suites: Consent, Immediate Opt-out, Data Purge, Case Suppression
    └── phase6\                # Master Benchmark: T01–T42 và X01–X32 toàn diện (75 tests passed)
```

---

## 4. HƯỚNG DẪN KHỞI CHẠY & KIỂM THỬ

### Cài đặt dependencies:
```powershell
cd D:\CSKH
npm install
```

### Chạy toàn bộ 75 Tests tự động (100% Passed):
```powershell
npm test
```

### Khởi chạy Gateway Server (Port 3002):
```powershell
npm start
```

### Danh mục API Endpoints khả dụng:
- **Tương tác Chat với May:** `POST http://localhost:3002/api/chat`
- **Tra cứu Catalog:** `GET http://localhost:3002/api/catalog`
- **Tính toán Báo giá (Quote):** `POST http://localhost:3002/api/quote`
- **Chuẩn bị đơn hàng (Prepare Order):** `POST http://localhost:3002/api/orders/prepare`
- **Chốt đơn hàng (Commit Order):** `POST http://localhost:3002/api/orders/commit`
- **Tra cứu đơn hàng (Object Auth):** `GET http://localhost:3002/api/orders/status?orderId=...&phone=...`
- **Tạo mã VietQR thanh toán:** `POST http://localhost:3002/api/payment/generate-qr`
- **Webhook Đa kênh Meta Platform:** `GET/POST http://localhost:3002/api/webhook/meta`
- **Webhook Thanh toán SePay:** `POST http://localhost:3002/api/webhook/sepay`
- **Quản trị Kill Switch:** `GET/POST http://localhost:3002/api/admin/killswitch`
- **Health Check & Readiness:** `GET /livez`, `GET /readyz`, `GET /api/health`
