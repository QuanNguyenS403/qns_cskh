# SỔ TAY VẬN HÀNH HỆ THỐNG AI AGENT CSKH MAY — QUANNGUYENS (quannguyens.com)

**Phiên bản:** 1.0 · **Ngày phát hành:** 22/10/2026 · **Múi giờ:** Asia/Ho_Chi_Minh  
**Căn cứ:** `QuanNguyenS_AI_CSKH_Master_Blueprint_v2_2026-10-22.md` & Master Build Prompts A & B  
**Phạm vi hệ thống:** `D:\CSKH` (Kho lưu trữ duy nhất, độc lập và bảo vệ toàn vẹn)

---

## 1. TỔNG QUAN HỆ THỐNG & NGUYÊN TẮC BẤT BIẾN

May là hệ thống AI Agent CSKH tự động hóa 24/7, vận hành theo sát toàn bộ vòng đời khách hàng từ **Khám phá -> Tư vấn size -> Báo giá -> Đặt hàng -> Thanh toán -> Vận chuyển -> Hậu mãi/Đổi trả -> Chăm sóc quay lại**.

### 5 Nguyên tắc vàng:
1. **Minh bạch AI (B01, X15):** May luôn công khai mình là trợ lý AI. Không giả làm người, không nói "mặc thử", "đang đứng ở kho" hay "gọi shipper".
2. **Không tự tính tiền & Không bịa đặt (B02, B03):** Toàn bộ số tiền đều do server-side `PricingService` tính toán chính xác số nguyên VND. Nếu thông số/xuất xứ catalog ghi `null` (như xuất xứ vải), May tuyệt đối không tự bịa đặt là "vải nhập Châu Âu" (T03).
3. **Quyền do Backend kiểm soát (B05, B06):** Mọi thao tác ghi (đặt hàng, sửa đơn, hoàn tiền) bắt buộc đi kèm Confirmation Token HMAC-SHA256 (TTL 5 phút, khóa theo hash payload, dùng 1 lần duy nhất).
4. **Đối soát thanh toán độc lập (B08, T13):** Chỉ ghi nhận `PAID` khi có webhook xác thực từ ngân hàng/SePay hoặc đối soát có thẩm quyền. Ảnh chuyển khoản do khách gửi chỉ được dùng làm bằng chứng đối chiếu, không tự chuyển trạng thái đơn.
5. **Chống Prompt Injection & IDOR (B10, B15):** Tin nhắn từ khách là dữ liệu không đáng tin (`<untrusted_user_input>`). Mã đơn 1 mình không đủ để tra cứu/sửa đổi đơn, bắt buộc phải xác minh đúng số điện thoại đặt hàng (X12).

---

## 2. KIẾN TRÚC PHẦN MỀM & CÁC DỊCH VỤ CỐT LÕI

| Mô-đun | Tệp nguồn | Nhiệm vụ chính |
| --- | --- | --- |
| **Database & Migrations** | `src/db/connection.js`, `src/db/migrations.js` | SQLite WAL mode, 18 bảng cốt lõi, hỗ trợ migration up/down nguyên tử |
| **Catalog Chuẩn Hóa** | `src/catalog/products.js` | SKU chuẩn (`QNS-DAYBREAK-SET`, `QNS-STILLWATER-SET`, `QNS-HEARTH-SET`), bảng đo tách biệt vòng cơ thể vs phẳng thành phẩm |
| **Policy Registry** | `src/policies/policyRegistry.js` | Quản lý phiên bản DRAFT vs APPROVED; đóng băng Snapshot chính sách gắn đơn hàng (Gate T42) |
| **Pricing Engine** | `src/pricing/pricingService.js` | Tính số nguyên VND, chiết khấu chuyển khoản 5%, freeship sau giảm (Gate T08), cấp Quote có TTL |
| **Knowledge Base RAG** | `src/knowledge/knowledgeBase.js` | Tìm kiếm lai tiếng Việt không dấu/đồng nghĩa, kèm `source_doc_id@version` |
| **May Persona & Core** | `src/agent/mayOrchestrator.js` | Điều phối hội thoại, thấu cảm, xử lý teencode và các tình huống X01–X15 |
| **Grounding Checker** | `src/agent/groundingChecker.js` | Kiểm duyệt trước khi xuất xưởng: chặn rò rỉ secret, chặn bịa giá, chặn injection |
| **Order & Reservation** | `src/orders/orderService.js`, `src/inventory/inventoryService.js` | Giữ tồn kho thật, prepare/commit order với token HMAC, tạo QR VietQR chuẩn |
| **Cases & RMA Engine** | `src/cases/caseService.js` | Quản lý Case P0-P3, RMA đổi trả theo snapshot đơn, xử lý sự cố scan giao chưa nhận (V6) |
| **Outbound & Consent** | `src/lifecycle/lifecycleEngine.js`, `src/channels/canSend.js` | Kiểm soát can_send, hủy ngay job khi opt-out (X27), chặn marketing khi có case mở (T34) |

---

## 3. CÁC QUY TRÌNH NGHIỆP VỤ ĐIỂN HÌNH

### 3.1. Quy trình Tư vấn & Báo giá (Quote)
```
Khách hỏi giá/size ──> May nhận diện mẫu (nếu mập mờ -> hỏi chọn 1 trong 3 mẫu)
                  ──> Gọi PricingService.calculateQuote()
                  ──> Trả giá niêm yết VND + hỏi chiều cao/cân nặng/sở thích mặc
```

### 3.2. Quy trình Chốt đơn hàng (2-Phase Commit)
```
1. Khách đồng ý chốt ──> OrderService.prepareOrder()
                     ──> Kiểm tra tồn kho & tạo Reservation (15 phút)
                     ──> Sinh Confirmation Token (HMAC-SHA256, hash payload, TTL 5 phút)
                     ──> May gửi bản tóm tắt (che PII: 091****678) xin xác nhận
2. Khách bấm Xác nhận ──> OrderService.commitOrder()
                     ──> Kiểm tra token (hợp lệ + chưa dùng + hash khớp)
                     ──> Ghi đơn SQLite, tiêu thụ Quote & Reservation
                     ──> Tạo Policy Snapshot gắn với đơn (bảo vệ quyền lợi cũ theo T42)
                     ──> Trả mã đơn chuẩn QNS-XXXXXX-XXXX
```

### 3.3. Quy trình Thanh toán VietQR & Đối soát SePay
- May sinh mã QR QuickLink chứa nội dung cú pháp `QNS XXXXXXXX` và tài khoản ngân hàng lấy từ biến môi trường.
- Webhook SePay gọi `POST /api/webhook/sepay`:
  - `eventGateway` kiểm tra chữ ký & khử trùng lặp qua `UNIQUE(gateway, transaction_id)`.
  - Khớp 100% số tiền -> Đơn chuyển `payment_status = 'PAID'`.
  - Chuyển thiếu tiền (X17) -> Ghi nhận `PARTIAL`, giữ đơn `UNPAID`, báo số tiền thiếu.
  - Chuyển thừa tiền (X17) -> Ghi nhận `PAID`, cắm cờ `OVERPAID` để hoàn tiền thừa.
  - Chuyển vào đơn đã hủy (X18) -> Cắm cờ `FLAGGED_CANCELLED_ORDER`, mở case hỗ trợ.

### 3.4. Quy trình Đổi / Trả / Sự cố giao hàng
- Đơn hàng gặp sự cố lỗi vải/đường may (X23): Shop chịu 100% phí ship 2 chiều.
- Đổi size nhưng hết hàng (X24): May thông báo trung thực, đưa 3 lựa chọn (chờ hàng mới, đổi mẫu khác bằng giá, hoặc hoàn tiền). Tuyệt đối không tự ý đổi mẫu.
- Scan "đã giao" nhưng khách báo chưa nhận (V6): May ghi nhận sự cố thật, mở ngay Case P1 đối soát bưu cục, dừng mọi kịch bản bán thêm/chăm sóc.

---

## 4. LỊCH VẬN HÀNH & GIÁM SÁT HẰNG NGÀY

1. **Đầu ca sáng (08:30):**
   - Kiểm tra Endpoint Health: `GET http://localhost:3002/readyz`.
   - Kiểm tra các lời hứa / cam kết đến hạn: `SELECT * FROM promises WHERE status = 'PENDING' AND due_at <= datetime('now')`.
2. **Trong ngày:**
   - Theo dõi trạng thái Webhook Meta Platform và SePay trong logs.
   - Xử lý các Case P1/P0 được May điều phối (Handoff).
3. **Cuối ngày (22:00):**
   - Hệ thống tự động kích hoạt Quiet Hours (20:00 – 09:00 sáng hôm sau): Toàn bộ tin nhắn chủ động tiếp thị tự động hoãn (DEFER).
