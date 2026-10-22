# RUNBOOK XỬ LÝ SỰ CỐ & KILL SWITCH — HỆ THỐNG CSKH QUANNGUYENS

**Tài liệu dành cho:** Quản trị viên hệ thống & Chủ shop (Quan)  
**Mục đích:** Kích hoạt ngắt khẩn cấp (Kill Switch), khôi phục dữ liệu, rollback migration, và cô lập lỗi an toàn mà không làm mất trạng thái đơn hàng.

---

## 1. CÁC CẤP ĐỘ CỦA KILL SWITCH

Hệ thống hỗ trợ 3 cấp độ ngắt khẩn cấp độc lập:

| Cấp độ | Phạm vi | Trường hợp sử dụng |
| --- | --- | --- |
| **Global Kill Switch** | Dừng toàn bộ các hành động ghi và gửi tin trên mọi kênh | Phát hiện lỗi bảo mật nghiêm trọng, tấn công dồn dập hoặc CSDL gặp sự cố phần cứng |
| **Action Kill Switch** | Tắt một hành động cụ thể (`commit_order`, `reconcile_payment`, `create_refund`) | Có nghi vấn tính toán sai tiền ở một tính năng nhất định nhưng các tính năng tư vấn khác vẫn hoạt động bình thường |
| **Channel Kill Switch** | Tắt một kênh kết nối (`messenger`, `instagram`, `threads`, `zalo`) | Token của kênh bị lỗi, Meta/Zalo đổi chính sách đột ngột hoặc kênh bị spam |

---

## 2. HƯỚNG DẪN KÍCH HOẠT KILL SWITCH QUA API

### 2.1. Tra cứu trạng thái Kill Switch hiện tại
```bash
curl -X GET http://localhost:3002/api/admin/killswitch
```

Phản hồi mẫu:
```json
{
  "global_killed": false,
  "actions": {
    "commit_order": true,
    "reconcile_payment": true,
    "create_refund": true
  },
  "channels": {
    "web": true,
    "messenger": true,
    "instagram": true,
    "threads": true,
    "zalo": true
  }
}
```

### 2.2. Dừng khẩn cấp toàn cục (Global Emergency Stop)
```bash
curl -X POST http://localhost:3002/api/admin/killswitch \
  -H "Content-Type: application/json" \
  -d '{
    "secret": "super_secret_admin_key_quannguyens",
    "level": "global",
    "state": true,
    "reason": "Phát hiện nghi vấn rà soát lỗi bảo mật, tạm dừng toàn bộ giao dịch"
  }'
```

### 2.3. Tắt riêng tính năng chốt đơn (Disable commit_order action)
```bash
curl -X POST http://localhost:3002/api/admin/killswitch \
  -H "Content-Type: application/json" \
  -d '{
    "secret": "super_secret_admin_key_quannguyens",
    "level": "action",
    "target": "commit_order",
    "state": false,
    "reason": "Đang bảo trì bảng giá, tạm khóa chốt đơn mới"
  }'
```

### 2.4. Tắt riêng kênh Instagram (Disable Instagram Channel)
```bash
curl -X POST http://localhost:3002/api/admin/killswitch \
  -H "Content-Type: application/json" \
  -d '{
    "secret": "super_secret_admin_key_quannguyens",
    "level": "channel",
    "target": "instagram",
    "state": false,
    "reason": "Token Instagram hết hạn, chờ gia hạn token"
  }'
```

---

## 3. PHỤC HỒI KHI TIẾN TRÌNH BỊ CRASH ĐỘT NGỘT (GATE T10, T37)

Cơ chế bền vững tự phục hồi:
1. **Trạng thái lưu trữ:** Toàn bộ dữ liệu nằm trong tệp SQLite `data/cskh.db` ở chế độ WAL (Write-Ahead Logging). Khi máy chủ khởi động lại:
   - Các Job chưa hoàn tất (`READY` hoặc `LEASE_EXPIRED`) sẽ tự động được bộ lập lịch `claimNextJob` nhận lại.
   - Các sự kiện Webhook đã nhận có `UNIQUE(source, event_id)` đảm bảo khi đối tác gửi lại (retry) không bị chạy trùng lần hai.
2. **Khởi động lại cổng dịch vụ CSKH:**
   ```powershell
   cd D:\CSKH
   npm start
   ```

---

## 4. ROLLBACK MIGRATION CƠ SỞ DỮ LIỆU

Trong trường hợp cần quay ngược schema CSDL về phiên bản trước:
```javascript
import { getDb } from './src/db/connection.js'
import { rollbackMigration } from './src/db/migrations.js'

const db = getDb()
rollbackMigration(db, 1) // Rollback về phiên bản 1
```
Bảng `_migrations` sẽ theo dõi chính xác từng bước và đảo ngược an toàn.
