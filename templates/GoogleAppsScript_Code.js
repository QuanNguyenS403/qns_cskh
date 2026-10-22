/**
 * ==============================================================================
 * QUANNGUYENS — GOOGLE APPS SCRIPT ĐỒNG BỘ ĐƠN HÀNG VỚI AI AGENT CSKH (MAY)
 * HOÀN TOÀN MIỄN PHÍ VÔ THỜI HẠN — TÍCH HỢP TRỰC TIẾP TRÊN GOOGLE SHEETS
 * ==============================================================================
 * 
 * Hướng dẫn cài đặt nhanh (Mất 1 phút):
 * 1. Mở file Google Sheet quản lý đơn hàng của bạn.
 * 2. Trên thanh menu, chọn: Tiện ích mở rộng (Extensions) > Apps Script.
 * 3. Xóa hết code cũ (nếu có), dán toàn bộ đoạn mã này vào.
 * 4. Sửa biến WEBHOOK_URL thành địa chỉ server của bạn (hoặc link ngrok/cloudflare tunnel).
 * 5. Bấm biểu tượng "Lưu" (Ctrl + S).
 * 6. Xong! Bất cứ khi nào bạn đổi cột "Trạng thái" thành "ĐÃ GIAO" hoặc "ĐÃ NHẬN",
 *    Google Sheet sẽ tự động kích hoạt May gửi tin nhắn chăm sóc khách hàng ngay lập tức!
 */

// ── CẤU HÌNH LIÊN KẾT SERVER AI CSKH ──────────────────────────
var CSKH_CONFIG = {
  // Thay đổi URL này thành domain server AI của bạn
  // Ví dụ: "https://cskh.quannguyens.com/api/webhook/google-sheets" hoặc link Cloudflare Tunnel
  WEBHOOK_URL: "http://localhost:3002/api/webhook/google-sheets",

  // Khóa bảo mật (phải khớp với GOOGLE_SHEET_WEBHOOK_SECRET trong file .env)
  WEBHOOK_SECRET: "quannguyens_sheets_secret_2026",

  // Tên sheet chứa đơn hàng cần theo dõi (mặc định lấy sheet đầu tiên nếu để rỗng)
  TARGET_SHEET_NAME: "", 

  // Các từ khóa xác nhận khách đã nhận hàng thành công
  DELIVERED_KEYWORDS: ["ĐÃ GIAO", "DA GIAO", "ĐÃ NHẬN", "DA NHAN", "GIAO THÀNH CÔNG", "DELIVERED", "THÀNH CÔNG"]
};

/**
 * Tự động kích hoạt khi người dùng chỉnh sửa ô trên Google Sheet
 */
function onEdit(e) {
  if (!e || !e.range) return;

  var sheet = e.range.getSheet();
  if (CSKH_CONFIG.TARGET_SHEET_NAME && sheet.getName() !== CSKH_CONFIG.TARGET_SHEET_NAME) {
    return;
  }

  var row = e.range.getRow();
  var col = e.range.getColumn();

  // Bỏ qua dòng tiêu đề
  if (row <= 1) return;

  var editedValue = String(e.value || e.range.getValue() || "").trim().toUpperCase();

  // Kiểm tra xem giá trị vừa sửa có phải là trạng thái ĐÃ GIAO / ĐÃ NHẬN không
  var isDeliveredStatus = CSKH_CONFIG.DELIVERED_KEYWORDS.some(function(keyword) {
    return editedValue === keyword || editedValue.indexOf(keyword) !== -1;
  });

  if (!isDeliveredStatus) return;

  // Đọc toàn bộ dữ liệu của dòng đó cùng dòng tiêu đề
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var rowValues = sheet.getRange(row, 1, 1, lastCol).getValues()[0];

  // Ánh xạ tiêu đề cột sang object dữ liệu
  var orderData = {};
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i]).toLowerCase().trim();
    // Bỏ dấu tiếng Việt để dễ so khớp
    var normHeader = removeVietnameseTones(h);
    orderData[normHeader] = rowValues[i];
  }

  // Trích xuất các trường thông tin đơn hàng
  var orderId = orderData["ma don"] || orderData["ma don hang"] || orderData["order id"] || orderData["order_id"] || orderData["ma"];
  var customerName = orderData["ten khach"] || orderData["ten"] || orderData["khach hang"] || orderData["customer"] || orderData["ho ten"] || "Khách hàng";
  var customerPhone = orderData["sdt"] || orderData["so dien thoai"] || orderData["phone"] || "";
  var items = orderData["san pham"] || orderData["items"] || orderData["don hang"] || orderData["mon hang"] || "";
  var channel = orderData["kenh"] || orderData["channel"] || "messenger";
  var channelSenderId = orderData["id kenh"] || orderData["sender id"] || orderData["sender_id"] || orderData["id_khach"] || orderData["facebook_id"] || "";

  if (!orderId) {
    SpreadsheetApp.getActiveSpreadsheet().toast("⚠️ Cột Mã đơn trống, May chưa thể gửi tin chăm sóc.", "CSKH QuanNguyenS", 5);
    return;
  }

  // Gửi sự kiện sang AI CSKH Gateway
  try {
    var payload = {
      secret: CSKH_CONFIG.WEBHOOK_SECRET,
      action: "delivery_confirmed",
      orderId: String(orderId).trim(),
      customerName: String(customerName).trim(),
      customerPhone: String(customerPhone).trim(),
      items: String(items).trim(),
      channel: String(channel).trim().toLowerCase(),
      channelSenderId: String(channelSenderId).trim(),
      confirmedBy: "Chủ shop (Google Sheet)"
    };

    var options = {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    var response = UrlFetchApp.fetch(CSKH_CONFIG.WEBHOOK_URL, options);
    var resCode = response.getResponseCode();
    var resText = response.getContentText();

    if (resCode >= 200 && resCode < 300) {
      SpreadsheetApp.getActiveSpreadsheet().toast(
        "🌸 May đã tiếp nhận và kích hoạt tin nhắn chăm sóc đơn #" + orderId + " (" + customerName + ")!",
        "QuanNguyenS CSKH 24/7",
        6
      );
    } else {
      SpreadsheetApp.getActiveSpreadsheet().toast(
        "❌ Lỗi gửi sang May: HTTP " + resCode,
        "QuanNguyenS CSKH Lỗi",
        6
      );
    }
  } catch (err) {
    SpreadsheetApp.getActiveSpreadsheet().toast(
      "❌ Lỗi kết nối AI Server: " + err.message,
      "QuanNguyenS CSKH",
      6
    );
  }
}

/**
 * Thêm Menu điều khiển trên Google Sheets để kiểm tra kết nối nhanh
 */
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu("🤖 CSKH QuanNguyenS")
    .addItem("Kiểm tra kết nối AI Agent (May)", "testConnection")
    .addToUi();
}

/**
 * Kiểm tra kết nối nhanh từ Google Sheets tới AI CSKH Gateway
 */
function testConnection() {
  try {
    var healthUrl = CSKH_CONFIG.WEBHOOK_URL.replace("/api/webhook/google-sheets", "/api/health");
    var response = UrlFetchApp.fetch(healthUrl, { muteHttpExceptions: true });
    if (response.getResponseCode() === 200) {
      SpreadsheetApp.getUi().alert("✅ Kết nối thành công tới AI Agent CSKH May (QuanNguyenS)!\nHệ thống sẵn sàng tự động hóa 24/7.");
    } else {
      SpreadsheetApp.getUi().alert("⚠️ Máy chủ phản hồi mã: " + response.getResponseCode());
    }
  } catch (e) {
    SpreadsheetApp.getUi().alert("❌ Không thể kết nối tới Server: " + e.message + "\nHãy kiểm tra xem Webhook URL đã chính xác chưa.");
  }
}

/**
 * Hàm phụ trợ bỏ dấu tiếng Việt chuẩn
 */
function removeVietnameseTones(str) {
  str = String(str || "").toLowerCase();
  str = str.replace(/à|á|ạ|ả|ã|â|ầ|ấ|ậ|ẩ|ẫ|ă|ằ|ắ|ặ|ẳ|ẵ/g, "a");
  str = str.replace(/è|é|ẹ|ẻ|ẽ|ê|ề|ế|ệ|ể|ễ/g, "e");
  str = str.replace(/ì|í|ị|ỉ|ĩ/g, "i");
  str = str.replace(/ò|ó|ọ|ỏ|õ|ô|ồ|ố|ộ|ổ|ỗ|ơ|ờ|ớ|ợ|ở|ỡ/g, "o");
  str = str.replace(/ù|ú|ụ|ủ|ũ|ư|ừ|ứ|ự|ử|ữ/g, "u");
  str = str.replace(/ỳ|ý|ỵ|ỷ|ỹ/g, "y");
  str = str.replace(/đ/g, "d");
  str = str.replace(/[^a-z0-9]/g, " ");
  return str.replace(/\s+/g, " ").trim();
}
