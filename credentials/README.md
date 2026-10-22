# GOOGLE SERVICE ACCOUNT CREDENTIALS

Để AI Agent (May) kết nối trực tiếp vào Google Sheet riêng tư (không cần chia sẻ công khai):

1. Truy cập [Google Cloud Console](https://console.cloud.google.com/) (Hoàn toàn miễn phí, không cần thẻ tín dụng).
2. Tạo một Service Account (Tài khoản dịch vụ):
   - Đặt tên ví dụ: `quannguyens-cskh`
   - Bấm **Keys (Khóa)** > **Add Key** > **Create new key** > Chọn **JSON** > Bấm **Create**.
3. Tải file JSON về và đổi tên thành:
   `google-service-account.json`
4. Dán file đó vào thư mục này:
   `D:\CSKH\credentials\google-service-account.json`
5. Mở Google Sheet của bạn > Bấm **Chia sẻ (Share)** > Dán địa chỉ email của Service Account (dạng `xxx@project.iam.gserviceaccount.com`) vào và chọn quyền **Người xem (Viewer)**.

*Thư mục này và các file `*.json` chứa khóa bí mật đã được bảo vệ trong `.gitignore`, không bao giờ bị lộ lên GitHub.*
