# QUANNGUYENS — HƯỚNG DẪN KẾT NỐI GOOGLE SHEETS & TỰ ĐỘNG CHĂM SÓC KHÁCH HÀNG (MAY)

**Phiên bản:** 1.0 · **Môi trường:** Production 24/7 · **Chi phí:** 100% MIỄN PHÍ VÔ THỜI HẠN

Tài liệu này hướng dẫn chi tiết quy trình:
1. **AI Agent (May) tư vấn 24/7**: Chăm sóc, giải đáp, giữ chân và thúc đẩy khách chốt đơn (ưu đãi giảm 5% VietQR Vietcombank, Freeship từ 500k).
2. **Chủ shop xác nhận trên Google Sheet**: Đơn hàng giao xong, chủ shop chỉ cần chuyển trạng thái thành `ĐÃ GIAO` hoặc `ĐÃ NHẬN`.
3. **May kích hoạt nhắn tin ngay**: Tự động hỏi thăm tình trạng kiện hàng, trải nghiệm mặc thử, hướng dẫn bảo quản và sẵn sàng hỗ trợ đổi size.

---

## I. MẪU BẢNG GOOGLE SHEET CHUẨN

Để AI Agent đọc thông tin chính xác nhất, bạn tạo Google Sheet với dòng tiêu đề (Dòng 1) như sau:

| Cột A | Cột B | Cột C | Cột D | Cột E | Cột F | Cột G |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Mã đơn** | **Tên khách** | **SĐT** | **Sản phẩm** | **Trạng thái** | **Kênh** | **ID Kênh** |
| QNS-202610-01 | Chị Lan Anh | 0912345678 | The Daybreak Set (Size M) | **ĐÃ NHẬN** | messenger | 8374928174 |
| QNS-202610-02 | Anh Minh | 0987654321 | The Stillwater Set (Size L) | Đang giao | instagram | 7281920192 |

> **Ghi chú về các cột:**
> - **Trạng thái:** Khi bạn nhập hoặc chọn `ĐÃ GIAO`, `ĐÃ NHẬN`, hoặc `GIAO THÀNH CÔNG`, May sẽ lập tức gửi tin nhắn chăm sóc.
> - **Kênh:** `messenger` (Facebook), `instagram`, hoặc `zalo`.
> - **ID Kênh:** ID người dùng trên Fanpage/Instagram/Zalo (do khách chat đến trước đó).

---

## II. HAI PHƯƠNG ÁN KẾT NỐI (HOÀN TOÀN FREE 100%)

### 🌟 Phương án 1 (Khuyên dùng): Google Apps Script (Bắn tín hiệu tức thì < 1 giây)

Đây là tính năng có sẵn miễn phí 100% của Google Sheets, hoạt động vĩnh viễn không cần thẻ tín dụng hay dự án Google Cloud.

#### Các bước cài đặt (Mất 1 phút):
1. Mở file Google Sheet của bạn.
2. Trên thanh menu, chọn: **Tiện ích mở rộng** (Extensions) > **Apps Script**.
3. Mở file [`templates/GoogleAppsScript_Code.js`](file:///D:/CSKH/templates/GoogleAppsScript_Code.js), copy toàn bộ nội dung và dán vào cửa sổ Apps Script.
4. Kiểm tra dòng 21:
   ```javascript
   WEBHOOK_URL: "https://your-domain/api/webhook/google-sheets" // Link server của bạn
   ```
   *(Nếu bạn đang chạy thử nghiệm nội bộ, dùng link Cloudflare Tunnel hoặc ngrok trỏ vào cổng 3002).*
5. Bấm biểu tượng **Lưu (Save)** (phím tắt `Ctrl + S`).
6. Quay lại Google Sheet, tải lại trang (F5). Bạn sẽ thấy xuất hiện menu mới: **🤖 CSKH QuanNguyenS** > Bấm **Kiểm tra kết nối AI Agent (May)** để xác nhận kết nối thành công.

---

### 🌟 Phương án 2: Tự động quét nền (Không cần cài Script)

Nếu bạn không muốn cài Apps Script, hệ thống đã tích hợp sẵn cơ chế **Auto-Poller** tự động quét Google Sheet mỗi 30 giây:

1. Trên Google Sheet, bấm nút **Chia sẻ (Share)** ở góc trên bên phải.
2. Tại mục **Quyền truy cập chung**, chọn: **Bất kỳ ai có đường liên kết** > Quyền: **Người xem**.
3. Sao chép ID của Sheet từ đường link:
   - Link mẫu: `https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit`
   - Sheet ID là đoạn: `1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms`.
4. Mở file [`.env`](file:///D:/CSKH/.env) và dán vào:
   ```env
   GOOGLE_SHEET_ID=1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms
   GOOGLE_SHEET_AUTO_SYNC=true
   GOOGLE_SHEET_POLL_INTERVAL_MS=30000
   ```
5. Xong! Cứ mỗi 30 giây, máy chủ sẽ tự động kiểm tra xem có dòng nào chuyển sang `ĐÃ GIAO` hoặc `ĐÃ NHẬN` không và gửi tin nhắn ngay.

---

## III. NỘI DUNG MAY NHẮN TIN CHĂM SÓC KHÁCH HÀNG

Khi bạn xác nhận đơn hàng thành công trên Google Sheet, May sẽ tự động gửi thông điệp ấm áp và tinh tế:

> *"Dạ May chào [Tên khách] ạ! May thấy kiện hàng của mình gồm [Tên sản phẩm] (đơn hàng #[Mã đơn]) đã được giao thành công tới tay mình rồi ạ 🥰*
> 
> *May nhắn để hỏi thăm xem kiện hàng tới nơi có nguyên vẹn không ạ? Bạn đã mở ra mặc thử đồ chưa, phom dáng và chất vải sợi tự nhiên mặc lên người có vừa vặn và thoải mái như ý bạn không ạ?*
> 
> *Nếu có bất kỳ điểm nào bạn chưa ưng ý cần đổi size, hoặc cần May hướng dẫn cách giặt ủi/bảo quản để giữ cho sợi vải luôn mềm mượt, bạn cứ nhắn May để được hỗ trợ ngay bất cứ lúc nào nhé ạ!"*

---

## IV. BẢO ĐẢM NGUYÊN TẮC BẢO MẬT & CHỐNG SPAM (B06, B12)

- **Chống trùng 100%:** Mỗi đơn hàng chỉ được gửi tin chăm sóc sau nhận hàng **đúng 1 lần duy nhất**, dù bạn có sửa trạng thái nhiều lần trên Sheet.
- **Tôn trọng khách hàng:** Nếu khách từng nhắn *"đừng nhắn nữa / tắt thông báo"*, hệ thống tự động chặn gửi để không làm phiền khách.
- **Có hồ sơ khiếu nại:** Nếu đơn hàng đang có khiếu nại mở (chưa giải quyết xong), May sẽ tạm dừng gửi tin vui vẻ để tập trung giải quyết sự cố trước.
