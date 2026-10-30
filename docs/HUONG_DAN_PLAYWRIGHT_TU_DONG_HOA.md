# HƯỚNG DẪN TỰ ĐỘNG HÓA HOÀN TOÀN CSKH VỚI PLAYWRIGHT RPA (24/7)

> **Dành cho:** Quản trị viên hệ thống & Đội ngũ vận hành CSKH QuanNguyenS  
> **Nền tảng hỗ trợ:** Meta Business Suite Inbox (`business.facebook.com`), Facebook Fanpage Messenger & Instagram Direct  
> **Cơ chế:** Robotic Process Automation (Playwright Chromium) + Não bộ AI MayOrchestrator (RAG Tri thức & Báo giá)

---

## 1. TỔNG QUAN KIẾN TRÚC TỰ ĐỘNG HÓA

Thay vì phải giữ tab trình duyệt mở và bấm chuột thủ công (hoặc lo ngại về các hạn chế token của Meta Graph API), hệ thống **Playwright Auto-Pilot** là một worker độc lập chạy nền 24/7:

1. **Quản lý phiên bền vững (Persistent Session):**
   * Lưu trữ Cookie, LocalStorage, Token xác thực và hồ sơ trình duyệt vào `data/playwright_profile/` và `data/playwright_storage_state.json`.
   * **Chỉ cần đăng nhập 1 lần duy nhất**, các lần khởi động sau Playwright tự động nhận diện tài khoản mà không cần nhập lại mật khẩu hay OTP/2FA.
2. **Kỹ thuật chống gắn cờ (Stealth Evasion):**
   * Vô hiệu hóa cờ `--enable-automation` và ẩn thuộc tính `navigator.webdriver`.
   * Sử dụng User-Agent Chrome chính thức trên Windows, độ phân giải thực và hành vi gõ văn bản tự nhiên.
3. **Phân biệt thông minh (Smart Chat Extractor):**
   * Tự động nhận diện ranh giới trái/phải giữa tin nhắn của Khách và tin nhắn của Shop.
   * Lọc qua chữ ký độc quyền của thương hiệu để không bao giờ tự trả lời lại tin nhắn của chính mình.
   * Chỉ kích hoạt trả lời khi tin nhắn cuối cùng là của khách đang chờ.
4. **Kết nối trực tiếp Bộ não AI (In-Process RAG & Pricing Engine):**
   * Tra cứu catalog sản phẩm, bảng size 2 lớp (thông số cơ thể + số đo áo quần).
   * Tính toán báo giá số nguyên VND, miễn phí ship và khuyến mãi VietQR.
   * Kiểm duyệt an toàn (Grounding Checker), chống Prompt Injection trước khi gửi.

---

## 2. CÁC LỆNH VẬN HÀNH NHANH (QUICK START)

Các lệnh đã được tích hợp sẵn vào file [package.json](file:///D:/CSKH/package.json):

| Lệnh npm | Chức năng | Chế độ |
| :--- | :--- | :--- |
| `npm run playwright:install` | Cài đặt Chromium binary của Playwright | Tự động tải về máy |
| `npm run playwright:login` | Mở trình duyệt thật để Quản trị viên đăng nhập Meta 1 lần | Có giao diện (Headed) |
| `npm run playwright:dry-run` | Quét thử hộp thư và sinh câu trả lời AI (Không gửi thật) | Kiểm thử an toàn |
| `npm run playwright:worker` | Kích hoạt Auto-Pilot chạy ngầm 24/7 tự động quét & gửi tin | Chạy nền (Headless) |

---

## 3. QUY TRÌNH KÍCH HOẠT TỪNG BƯỚC

### Bước 1: Đăng nhập tài khoản Meta & Fanpage (1 lần duy nhất)
Mở cửa sổ dòng lệnh tại `D:\CSKH` và gõ:
```bash
npm run playwright:login
```
1. Cửa sổ trình duyệt Chromium sẽ tự động mở trang Hộp thư Meta Business Suite: `https://business.facebook.com/latest/inbox/all`.
2. Đăng nhập tài khoản Facebook/Instagram quản trị Fanpage của Shop.
3. Vượt qua bước xác thực 2FA/OTP (nếu có).
4. Khi giao diện Hộp thư hiển thị đầy đủ danh sách tin nhắn:
   * Quay lại màn hình Terminal và nhấn phím **[ENTER]**.
   * Hệ thống sẽ tự động xuất toàn bộ phiên làm việc sang `data/playwright_storage_state.json`.

---

### Bước 2: Chạy kiểm thử quét dữ liệu (Dry-Run)
Trước khi kích hoạt chế độ tự động gửi tin nhắn thật cho khách, hãy chạy kiểm thử:
```bash
npm run playwright:dry-run
```
* Hệ thống sẽ mở hộp thư ngầm, quét khách hàng mới nhất, tạo câu trả lời mẫu từ AI QNS và in ra màn hình mà **hoàn toàn KHÔNG nhấn gửi**.

---

### Bước 3: Kích hoạt Tự động hóa 24/7

#### Cách 1: Chạy trực tiếp qua Terminal / Batch Script
```bash
npm run playwright:worker
```
*(Hệ thống sẽ duy trì vòng lặp quét mỗi 6 giây, tự động phát hiện tin nhắn mới, sinh câu trả lời và phản hồi lập tức).*

#### Cách 2: Vận hành bền vững qua PM2 (Khuyến nghị cho Production)
File [ecosystem.config.cjs](file:///D:/CSKH/ecosystem.config.cjs) đã được cấu hình sẵn 2 tiến trình song song:
```bash
# Khởi động cả Server CSKH và Playwright Worker
npm run pm2:start

# Xem nhật ký hoạt động thời gian thực
pm2 logs quannguyens-playwright-worker

# Khởi động lại / Dừng khi cần
pm2 restart quannguyens-playwright-worker
pm2 stop quannguyens-playwright-worker
```

---

## 4. ĐIỀU KHIỂN TỰ ĐỘNG HÓA QUA REST API

Bạn có thể tích hợp việc Bật/Tắt Playwright Worker vào bảng điều khiển nội bộ hoặc gửi lệnh qua Postman/cURL:

### 1. Xem trạng thái vận hành
```http
GET http://localhost:3002/api/automation/status
```
**Phản hồi mẫu:**
```json
{
  "success": true,
  "service": "Playwright Meta Business Suite Auto-Pilot",
  "state": "RUNNING",
  "autoReply": true,
  "pollIntervalMs": 6000,
  "browserReady": true,
  "killSwitch": {
    "globalStopped": false,
    "playwrightBlocked": false
  },
  "stats": {
    "totalCycles": 1420,
    "totalRepliesSent": 86,
    "lastCycleAt": "2026-10-27T19:00:00.000Z",
    "lastCustomerProcessed": "Nguyen Van A"
  },
  "rateLimit": {
    "sentInLastHour": 18,
    "maxPerHour": 120
  }
}
```

### 2. Kích hoạt Worker từ xa
```http
POST http://localhost:3002/api/automation/start
```

### 3. Tạm dừng Worker (Pause)
```http
POST http://localhost:3002/api/automation/pause
```

### 4. Dừng hoàn toàn & Đóng trình duyệt (Stop)
```http
POST http://localhost:3002/api/automation/stop
```

### 5. Yêu cầu quét tức thì 1 chu kỳ (Manual Trigger)
```http
POST http://localhost:3002/api/automation/cycle
Content-Type: application/json

{ "dryRun": false }
```

---

## 5. CÁC LỚP BẢO VỆ AN TOÀN (SAFETY & GUARDRAILS)

1. **Bộ giới hạn tốc độ (Rate Limiting):**
   * Mặc định giới hạn tối đa `120 tin/giờ`. Nếu vượt quá ngưỡng, hệ thống tạm ngừng gửi và thông báo cảnh báo để phòng tránh tài khoản bị Meta xem là spam.
2. **Ngắt mạch tự động (Circuit Breaker):**
   * Nếu xảy ra 5 lỗi liên tiếp (ví dụ: mất mạng, Meta đổi giao diện, hoặc mất phiên đăng nhập), Worker tự động chuyển sang trạng thái `PAUSED` an toàn để không tiêu tốn tài nguyên và ghi log cảnh báo.
3. **Công tắc ngắt khẩn cấp 3 cấp (Kill Switch):**
   * Khi cần dừng riêng kênh Playwright mà không muốn tắt cả Server CSKH, quản trị viên chỉ cần gọi:
   ```bash
   # Gửi qua API Admin KillSwitch
   curl -X POST http://localhost:3002/api/admin/killswitch \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer <ADMIN_SECRET>" \
     -d '{"level": "channel", "target": "playwright", "state": false, "reason": "Bảo trì giao diện"}'
   ```
   * Playwright Worker sẽ ngay lập tức bỏ qua mọi thao tác gửi tin nhắn cho đến khi kênh được mở lại.
