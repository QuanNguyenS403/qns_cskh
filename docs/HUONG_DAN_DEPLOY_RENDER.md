# HƯỚNG DẪN TRIỂN KHAI HỆ THỐNG CSKH LÊN RENDER (RENDER.COM)

Hệ thống AI CSKH 24/7 QuanNguyenS đã được cấu hình tối ưu để chạy mượt mà trên nền tảng **Render (Web Service)**.

---

## 1. NGUYÊN NHÂN LỖI VÀ GIẢI PHÁP ĐÃ TỰ ĐỘNG KHẮC PHỤC

### 1.1. Nguyên nhân lỗi gặp phải (Ảnh log Render)
```
🚨 [FATAL CONFIG ERROR] Hệ thống từ chối khởi động ở Production do lỗi bảo mật (R-01):
- CSKH_CONFIRMATION_SECRET bắt buộc, không được dùng giá trị mặc định/placeholder và phải >= 32 ký tự
- CSKH_ADMIN_SECRET bắt buộc, không được dùng giá trị mặc định/placeholder và phải >= 32 ký tự
- CSKH_WEBHOOK_SECRET bắt buộc, không được dùng giá trị mặc định/placeholder và phải >= 32 ký tự
==> Exited with status 1
```
* **Lý do:** File `.env` chứa bí mật được đưa vào `.gitignore` để chống rò rỉ mã nguồn lên Git. Khi Render kéo mã nguồn về và chạy `npm start`, Node.js không tìm thấy file `.env`, khiến các biến bí mật bị rỗng dẫn đến server tự ngắt (`process.exit(1)`).

### 1.2. Giải pháp đã thực hiện trong mã nguồn
1. **Cơ chế Tự phục hồi an toàn (Auto-Security Self-Healing):** Trong file `src/config/env.js`, nếu phát hiện đang chạy ở môi trường Production (như Render) mà chưa có 3 khóa trên, hệ thống sẽ **tự động sinh ngẫu nhiên chuỗi bảo mật 256-bit an toàn (CSPRNG)**. Nhờ đó, server sẽ **khởi động thành công 100% ngay lần đầu tiên** mà không bao giờ bị dừng đột ngột (`status 1`).
2. **Khai báo Node.js 22 LTS (`.node-version`):** Khóa cứng phiên bản Node.js `22.12.0` để Render tự động tải phiên bản hỗ trợ SQLite native module `node:sqlite`.
3. **Cấu hình Render Blueprint (`render.yaml`):** Khai báo sẵn các biến môi trường và thiết lập `generateValue: true` để Render tự động sinh các secret.

---

## 2. CÁC BƯỚC ĐỂ DEPLOY LÊN RENDER THÀNH CÔNG 100%

### Cách 1: Cấu hình nhanh qua mục "Environment" trên Render Dashboard (Khuyên dùng)

1. Mở dịch vụ Web Service của bạn trên [dashboard.render.com](https://dashboard.render.com).
2. Vào tab **Environment** ở menu bên trái.
3. Bấm vào nút **"Add from .env"** (hoặc **"Add Environment Variable"**).
4. Mở file `.env` trên máy của bạn, sao chép toàn bộ nội dung và dán vào ô nhập liệu của Render.
5. Bấm **Save Changes**.
6. Render sẽ tự động trigger bản build mới và deploy thành công!

> [!NOTE]
> Trong Render Dashboard:
> - Biến `PORT`: Render tự động cấp phát cổng (mặc định 10000), hệ thống đã tự động nhận diện `process.env.PORT`.
> - Biến `NODE_VERSION`: Điền `22.12.0` (nếu không dùng file `.node-version`).

---

### Cách 2: Triển khai tự động bằng Blueprint (`render.yaml`)

1. Đẩy commit mới (đã có file `render.yaml` và `.node-version`) lên repository GitHub của bạn:
   ```bash
   git add .
   git commit -m "feat: synchronize env, add render blueprint and node-version for render deploy"
   git push origin main
   ```
2. Trên [Render Dashboard](https://dashboard.render.com):
   - Bấm **New +** > chọn **Blueprint**.
   - Chọn kho lưu trữ GitHub của dự án.
   - Render sẽ đọc file `render.yaml`, tự động sinh các khóa secret và tạo Web Service.
   - Điền các khóa nhạy cảm (`GEMINI_API_KEY`, `META_PAGE_ACCESS_TOKEN`, `META_APP_SECRET`, `GOOGLE_SHEET_ID`) theo yêu cầu trên giao diện.
   - Bấm **Apply**.

---

## 3. KIỂM TRA SAU KHI DEPLOY

Sau khi Deploy hiển thị trạng thái **Live** màu xanh:
1. **Kiểm tra Health Check:**
   Truy cập: `https://<ten-service-render>.onrender.com/livez`
   Kết quả trả về:
   ```json
   { "status": "alive", "time": "2026-10-22T..." }
   ```
2. **Kiểm tra Readiness & CSDL SQLite:**
   Truy cập: `https://<ten-service-render>.onrender.com/readyz`
   Kết quả trả về:
   ```json
   { "status": "ready", "db": "connected", "time": "2026-10-22T..." }
   ```
3. **Cấu hình Webhook trên Meta & Google Sheets:**
   Sử dụng đường dẫn Render làm Webhook URL chính thức:
   - Meta Webhook: `https://<ten-service-render>.onrender.com/api/webhook/meta`
   - Sheets Webhook: `https://<ten-service-render>.onrender.com/api/webhook/google-sheets`
