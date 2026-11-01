# HƯỚNG DẪN VẬN HÀNH CLOUD 0Đ/THÁNG (TẮT HẲN LAPTOP VẪN CHẠY 24/7)
**Kiến trúc:** `Facebook Fanpage & Instagram (@qns.style)` ➔ `Botcake.io / AhaChat (Gói Free 0đ - Đối tác Meta đã xác minh)` ➔ `Render Cloud AI QuanNguyenS (https://cskh-2m9m.onrender.com)`

---

## 1. TẠI SAO CÁCH NÀY GIÚP TẮT HẲN LAPTOP VẪN CHẠY 24/7 MÀ KHÔNG TỐN 1 ĐỒNG?
1. **Không cần Xác minh doanh nghiệp (Business Verification):** **Botcake.io** (thuộc Pancake Việt Nam) và **AhaChat.com** đã là **Meta Official Tech Provider**. Bạn chỉ cần bấm nút **"Đăng nhập Facebook"** là kết nối được cả Fanpage `QuanNguyenS` lẫn Instagram `@qns.style` để trả lời **100% khách lạ**.
2. **Miễn phí 0đ trọn đời:**
   * **Botcake.io:** Gói Miễn phí tặng sẵn **500.000 tin nhắn tự động/tháng** (hỗ trợ sẵn khối `JSON API / HTTP Request` ngay ở gói Free).
   * **AhaChat.com:** Gói Miễn phí cũng mở sẵn khối `JSON API` cho cả Messenger & Instagram.
   * *(Lưu ý: Không cần dùng ManyChat vì ManyChat khóa tính năng External Request ở gói trả phí $15/tháng).*
3. **100% chạy trên Đám mây (Render Cloud):** Toàn bộ bộ não AI, báo giá pijama, tư vấn size, tạo mã VietQR nằm sẵn trên `https://cskh-2m9m.onrender.com` — **bạn tắt hẳn nguồn laptop mang đi bất cứ đâu AI vẫn trả lời khách trong 1–2 giây**.

---

## 2. CÀI ĐẶT TRONG 3 PHÚT TRÊN BOTCAKE.IO (KHUYÊN DÙNG — 0Đ)

### Bước 1: Kết nối Fanpage & Instagram vào Botcake (1 phút)
1. Truy cập **[https://botcake.io](https://botcake.io)** ➔ Bấm **Đăng nhập bằng Facebook** (dùng nick quản trị Fanpage `QuanNguyenS`).
2. Cấp quyền cho cả **Facebook Fanpage (`QuanNguyenS`)** và **Instagram Business (`@qns.style`)** khi hộp thoại Facebook hiện ra.

### Bước 2: Trỏ "Trả lời mặc định (Default Reply)" về AI Render Cloud (2 phút)
Làm thao tác này cho trang **QuanNguyenS** (và làm tương tự 1 lần cho trang Instagram **@qns.style**):

1. Vào mục **Tự động hóa (Automation)** ➔ **Trả lời mặc định (Default Reply)**:
   * Đổi tần suất gửi thành: **Mọi lúc (Every time)** *(để mỗi câu khách hỏi đều được đưa qua AI trả lời liên tục)*.
2. Xóa ô văn bản mẫu mặc định đi, bấm **Thêm thẻ mới** ➔ chọn **Hành động / Nâng cao** ➔ chọn khối **JSON API** (hoặc **HTTP Request / Dynamic Content**):
   * **Phương thức (Method):** `POST`
   * **URL (Sao chép chính xác dòng dưới):**
     ```text
     https://cskh-2m9m.onrender.com/api/webhook/botcake
     ```
   * **Headers:** `Content-Type` = `application/json`
   * **Body (JSON) — đối với Fanpage Messenger:**
     ```json
     {
       "psid": "{{psid}}",
       "full_name": "{{full_name}}",
       "text": "{{last_input_text}}",
       "platform": "messenger"
     }
     ```
   * *(Khi cài cho trang **Instagram `@qns.style`**, chỉ cần đổi `"platform": "instagram"`).*
   * *(Ghi chú: Nếu bạn dùng khối **HTTP Request** gán biến thay vì **JSON API** tự hiển thị, hãy map trường phản hồi `$.ai_reply` vào biến `{{ai_reply}}` rồi đặt 1 ô Text bên dưới điền `{{ai_reply}}`. Còn khối **JSON API / Dynamic** sẽ tự động đọc mảng `messages` để gửi luôn cả chữ lẫn ảnh mã QR VietQR cho khách!).*
3. Bấm **Lưu & Bật (Publish / Enable)**.

*(Nếu bạn thích dùng **AhaChat.com**, cách làm y hệt: vào **Trả lời mặc định** ➔ Thêm block **JSON API** ➔ chọn `POST` tới `https://cskh-2m9m.onrender.com/api/webhook/ahachat` với Body `{"sender_id":"{{sender_id}}","name":"{{full_name}}","text":"{{last_user_freeform_input}}","channel":"messenger"}`).*

---

## 3. GIỮ SERVER RENDER THỨC 24/7 KHÔNG BAO GIỜ NGỦ + BÁO ĐỘNG QUA EMAIL (1 PHÚT — 0Đ)

Gói Render Free sẽ tự ngủ nếu sau 15 phút không có ai ping (khiến tin nhắn đầu tiên bị trễ 40 giây). Để giữ Render **luôn thức 100% (phản hồi 1 giây)** và **tự gửi Email báo động khẩn cho bạn nếu server gặp sự cố**:

1. Truy cập **[https://uptimerobot.com](https://uptimerobot.com)** (đăng ký miễn phí bằng email `quannguyentop1lux@gmail.com`).
2. Bấm **+ Add New Monitor**:
   * **Monitor Type:** `HTTP(s)`
   * **Friendly Name:** `QuanNguyenS AI CSKH 24/7`
   * **URL (or IP):** `https://cskh-2m9m.onrender.com/api/ping`
   * **Monitoring Interval:** `5 minutes` (5 phút ping 1 lần)
   * Tích chọn gửi cảnh báo Email (`quannguyentop1lux@gmail.com`) khi Down.
3. Bấm **Create Monitor**.

✅ **Kết quả:** Render không bao giờ ngủ 1 giây nào suốt 365 ngày, và nếu hệ thống Cloud có bất kỳ lỗi sập mạng nào, UptimeRobot lập tức gửi Email báo khẩn cho bạn!

---

## 4. TẮT PLAYWRIGHT TRÊN LAPTOP SAU KHI ĐÃ BẬT BOTCAKE CLOUD
Sau khi bạn bật Botcake trên Cloud xong, để tránh cả Cloud và Laptop cùng trả lời trùng 2 lần khi bạn mở máy, hãy mở Terminal tại `d:\CSKH` chạy đúng 1 dòng lệnh sau để tắt hẳn Playwright trên laptop (giải phóng 100% RAM cho máy):

```powershell
npx pm2 delete quannguyens-playwright-worker; npx pm2 save
```

Từ giây phút đó, **bạn tắt hẳn nguồn laptop cất đi thoải mái**, hệ thống AI CSKH QuanNguyenS vẫn vận hành 100% trên đám mây 24/7!
