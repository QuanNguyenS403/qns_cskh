# PHIẾU XIN QUYỀN, BẢO MẬT & HƯỚNG DẪN XOAY VÒNG KHÓA (PHASE R0)

**Hệ thống:** QuanNguyenS 24/7 AI Customer Care & Action Gateway (`qns_cskh`)  
**Ngày lập:** 22/10/2026  
**Tiêu chuẩn tuân thủ:** Nguyên tắc Đặc quyền Tối thiểu (Principle of Least Privilege - PoLP) & Thiết kế Phòng thủ Đa tầng (Defense in Depth).

---

## 1. CẢNH BÁO BẢO MẬT KHẨN CẤP: DANH SÁCH KHÓA CẦN XOAY VÒNG (ROTATE)

Trong commit ban đầu `27324f3` trên GitHub repository công khai/nội bộ, một số khóa và token xác thực đã bị đẩy lên dạng plaintext trong file `.env.example` hoặc mã nguồn. Nhằm bảo vệ hệ thống và dữ liệu khách hàng tuyệt đối, chủ shop **CẦN XOAY VÒNG (REVOKE & REGENERATE)** các khóa sau đây:

| STT | Tên biến môi trường | Dịch vụ tương ứng | Mức độ rủi ro | Hành động khắc phục bắt buộc |
|---|---|---|---|---|
| 1 | `GEMINI_API_KEY` | Google AI Studio | **RẤT CAO** | Vào [Google AI Studio](https://aistudio.google.com/app/apikey), thu hồi (Delete) API Key cũ và tạo API Key mới. Gán hạn mức chi phí (Quotas). |
| 2 | `META_APP_SECRET` | Meta for Developers | **RẤT CAO** | Vào [Meta Developer App Settings](https://developers.facebook.com/apps/), Reset `App Secret` của ứng dụng `2127183014548256`. |
| 3 | `META_PAGE_ACCESS_TOKEN` | Meta Graph API | **RẤT CAO** | Tạo mới Page Access Token dài hạn (Never Expire System User Token) từ Meta Business Manager. |
| 4 | `INSTAGRAM_ACCESS_TOKEN` | Instagram Graph API | **CAO** | Cấp lại User/Page Token sau khi reset App Secret. |
| 5 | `THREADS_ACCESS_TOKEN` | Threads API | **TRUNG BÌNH** | Thu hồi và cấp lại token từ Threads App Dashboard. |
| 6 | `ADMIN_SECRET` / `CSKH_ADMIN_SECRET` | Hệ thống CSKH nội bộ | **RẤT CAO** | Đổi sang chuỗi ngẫu nhiên có độ dài tối thiểu 32 ký tự bảo mật (dùng `crypto.randomBytes(32).toString('hex')`). |
| 7 | `GOOGLE_SHEET_WEBHOOK_SECRET` | Google Sheets Apps Script | **CAO** | Đổi sang chuỗi bảo mật ngẫu nhiên và cập nhật đồng thời trong Apps Script code. |

---

## 2. NGUYÊN TẮC ĐẶC QUYỀN TỐI THIỂU (LEAST PRIVILEGE) CHO TỪNG KÊNH

Hệ thống CSKH chỉ yêu cầu các quyền vừa đủ để nhận tin nhắn và trả lời khách hàng, **tuyệt đối không cấp quyền quản trị cao cấp (Admin/Owner)** cho Bot:

### 2.1. Meta Platform (Facebook Messenger & Instagram Direct)
- **Chỉ yêu cầu các quyền (Permissions):**
  - `pages_messaging`: Nhận và gửi tin nhắn phản hồi CSKH trên Messenger Page.
  - `pages_show_list`: Đọc danh sách Page thuộc quyền quản lý.
  - `instagram_manage_messages`: Nhận và gửi tin nhắn Direct Instagram.
- **TUYỆT ĐỐI KHÔNG CẤP:**
  - `pages_manage_posts`, `pages_manage_ads`, `pages_read_user_content` (tránh rò rỉ dữ liệu bài viết hay quản lý tài khoản quảng cáo).

### 2.2. Zalo Official Account (OpenAPI v3.0)
- **Chỉ yêu cầu quyền:**
  - Gửi tin nhắn CSKH (1:1 với người dùng đã quan tâm hoặc nhắn tin vào OA trong 48h).
  - Webhook nhận sự kiện người dùng gửi tin (`user_send_text`).
- **Xác thực Webhook:**
  - Bắt buộc kiểm tra chữ ký HMAC-SHA256 (`mac` hoặc `x-zevent-signature`) bằng `ZALO_SECRET_KEY`. Từ chối mọi request không có chữ ký hợp lệ.

### 2.3. Google Service Account (Google Sheets API)
- **Nguyên tắc:**
  - Email Service Account: `ais-gemini-key-345788ad07e5474@832279994742.iam.gserviceaccount.com`
  - Chỉ chia sẻ quyền **Xem (Viewer)** hoặc **Người nhận xét (Commenter)** trên Google Sheet quản lý đơn hàng.
  - Chỉ cấp quyền **Chỉnh sửa (Editor)** nếu shop muốn Bot tự động đánh dấu cột "Đã chăm sóc sau nhận hàng". Không bao giờ cấp quyền chỉnh sửa cho toàn bộ Google Drive.

### 2.4. Cổng thanh toán ngân hàng (SePay / VietQR)
- **Nguyên tắc:**
  - Webhook chỉ xử lý dòng tiền vào (`transferType === 'in'`).
  - Hệ thống **từ chối 100%** mọi lệnh hoặc webhook báo chuyển tiền đi (`transferType === 'out'`).
  - Autonomy Refund bị vô hiệu hóa (`AUTONOMY_REFUND = false`): AI không có quyền tự động chuyển tiền trả lại tài khoản khách. Mọi đề xuất hoàn tiền đều được chuyển thành Phiếu Đề Xuất (Dossier) chờ Chủ shop duyệt thủ công.

---

## 3. LỆNH TẠO SECRET MỚI & KIỂM TRA PREFLIGHT

### 3.1. Tạo chuỗi bí mật ngẫu nhiên an toàn (Chạy trên Terminal)
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
*Sử dụng chuỗi sinh ra này để điền vào `CSKH_ADMIN_SECRET`, `CSKH_CONFIRMATION_SECRET`, và `GOOGLE_SHEET_WEBHOOK_SECRET` trong file `.env`.*

### 3.2. Lệnh kiểm tra an toàn toàn hệ thống (Test Suite)
```bash
npm test
```
*Tất cả 86/86 test cases phải PASS hoàn toàn, bao gồm 11 bài kiểm thử bảo mật nghiêm ngặt (C1–C5, H1–H13).*
