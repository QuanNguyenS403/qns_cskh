# HƯỚNG DẪN CẤU HÌNH KẾT NỐI ĐA KÊNH: FACEBOOK, INSTAGRAM, THREADS, ZALO
**Dự án:** QuanNguyenS — Hệ Thống AI CSKH 24/7 & Chăm Sóc Vòng Đời  
**Phạm vi:** Kênh Facebook Messenger, Instagram Direct, Threads API, Zalo Official Account (ZBS)

---

## 1. CỔNG TẬP TRUNG (UNIFIED WEBHOOK ENDPOINT)

Hệ thống CSKH đã thiết lập sẵn cổng Webhook hợp nhất cho Meta Platform tại:
* **Webhook URL:** `https://<ten-mien-cua-ban>/api/webhook/meta`
* **Verify Token mặc định:** `quannguyens_meta_verify_token_2026` (có thể đổi trong `.env`)
* **Chữ ký bảo mật (X-Hub-Signature-256):** Tự động xác thực qua `META_APP_SECRET`.

---

## 2. HƯỚNG DẪN CẤU HÌNH TỪNG NỀN TẢNG

### KÊNH 1: FACEBOOK MESSENGER (Fanpage QuanNguyenS)
1. **Truy cập Meta for Developers:** [developers.facebook.com](https://developers.facebook.com/)
2. **Tạo App:** Chọn loại ứng dụng **Business** (Doanh nghiệp).
3. **Thêm sản phẩm Messenger:**
   * Trong Dashboard, bấm chọn **Set up** (Thiết lập) tại mục **Messenger**.
   * Tại mục **Access Tokens**, chọn Fanpage QuanNguyenS và bấm **Generate Token**.
   * Sao chép mã Token này và dán vào file `.env`:
     ```env
     META_PAGE_ACCESS_TOKEN=EAAG...
     META_PAGE_ID=1000...
     ```
4. **Cấu hình Webhooks:**
   * Tại mục Webhooks của Messenger, bấm **Add Callback URL**:
     * **Callback URL:** `https://<ten-mien-cua-ban>/api/webhook/meta`
     * **Verify Token:** `quannguyens_meta_verify_token_2026`
   * Bấm **Verify and Save**.
   * Chọn các trường cần nhận: `messages`, `messaging_postbacks`, `message_reads`.

---

### KÊNH 2: INSTAGRAM DIRECT MESSAGING
1. **Điều kiện:** Tài khoản Instagram QuanNguyenS phải là tài khoản Chuyên nghiệp (Business/Creator) và đã liên kết với Fanpage Facebook.
2. **Bật tính năng nhắn tin:**
   * Vào Instagram trên điện thoại > **Cài đặt** > **Tin nhắn và phản hồi tin** > **Công cụ kết nối** > Bật **Cho phép truy cập tin nhắn** (Allow access to messages).
3. **Trên Meta for Developers:**
   * Thêm sản phẩm **Instagram Graph API**.
   * Tạo User Token có quyền: `instagram_basic`, `instagram_manage_messages`.
   * Dán vào file `.env`:
     ```env
     INSTAGRAM_ACCESS_TOKEN=EAAG...
     INSTAGRAM_ACCOUNT_ID=1784...
     ```
4. **Đăng ký Webhook Instagram:**
   * Trong Webhooks của App, chọn đối tượng **Instagram** và đăng ký trường `messages`.

---

### KÊNH 3: THREADS API (Tương tác & Chăm sóc trên Threads)
1. **Threads API:** Meta đã mở API chính thức cho Threads ([developers.facebook.com/docs/threads](https://developers.facebook.com/docs/threads)).
2. **Tạo quyền:**
   * Thêm quyền `threads_basic`, `threads_content_publish`, `threads_read_replies`.
3. **Cấu hình vào `.env`:**
   ```env
   THREADS_USER_ID=your_threads_user_id
   THREADS_ACCESS_TOKEN=TH...
   ```
4. **Hoạt động của May trên Threads:**
   * May sẽ tự động nhận diện các bình luận hoặc nhắc tên (mentions) hỏi về size, chất liệu, giá pijama và trả lời trực tiếp (Reply) trên Threads.

---

### KÊNH 4: ZALO OFFICIAL ACCOUNT (Zalo OA & ZBS Template)
1. **Truy cập Zalo for Developers:** [developers.zalo.me](https://developers.zalo.me/)
2. **Tạo App & Liên kết OA:**
   * Liên kết với OA QuanNguyenS đã xác thực.
   * Cấp quyền: `oa_send_message`, `oa_manage`.
3. **Đăng ký Template ZBS (Bắt buộc theo quy định 2026):**
   * Theo thông tư 2026 của Zalo, tin nhắn giao dịch ngoài cửa sổ 24h bắt buộc dùng ZBS Template đã được duyệt (như Thông báo xác nhận đơn, Cập nhật giao hàng).
   * Điền mã Token vào file `.env`:
     ```env
     ZALO_OA_ID=123456789...
     ZALO_APP_ID=456789...
     ZALO_SECRET_KEY=secret_key...
     ZALO_ACCESS_TOKEN=access_token...
     ```

---

## 3. CƠ CHẾ BẢO VỆ TỰ ĐỘNG (FAIL-SAFE) KHI CHƯA ĐIỀN TOKEN
* Nếu bạn chưa cấu hình Token, hệ thống sẽ tự động kích hoạt **Chế độ Giả lập An toàn (Mock Mode)**:
  * Không làm crash server.
  * Toàn bộ tin nhắn được ghi nhận đầy đủ vào CSDL `outbox` và `action_audits`.
* Khi bạn điền Token thật vào file `.env`, hệ thống sẽ lập tức gửi tin thật tới khách hàng mà không cần phải khởi động lại logic lõi.
