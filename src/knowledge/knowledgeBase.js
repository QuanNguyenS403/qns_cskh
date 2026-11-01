/**
 * KNOWLEDGE BASE & RETRIEVAL ENGINE (Blueprint §8, B02, B04, T01, T03, T04)
 * 
 * - Quản lý kho tài liệu tri thức đã được kiểm duyệt (Approved Facts).
 * - Tra cứu lai (Hybrid Search): Chuẩn hóa tiếng Việt (bỏ dấu/viết tắt/đồng nghĩa) + khớp từ khóa & danh mục.
 * - Mọi trích dẫn mang theo `source_doc_id@version` làm bằng chứng (evidence_ref).
 * - Chặn bịa đặt (B02, T03): Nếu tài liệu ghi nhận `null` hoặc chưa xác minh, trả về cảnh báo rõ ràng.
 */

import { CATALOG } from '../catalog/products.js'

// Bảng từ đồng nghĩa thực tế trong ngành thời trang / pijama Việt Nam
const SYNONYMS = {
  'do ngu': 'pijama',
  'đồ ngủ': 'pijama',
  'pyjama': 'pijama',
  'pizama': 'pijama',
  'quan ao ngu': 'pijama',
  'bộ ngủ': 'pijama',
  'set ngu': 'pijama',
  'chat lieu': 'vai',
  'chất liệu': 'vai',
  'chất vải': 'vai',
  'thành phần': 'vai',
  'phi ship': 'van chuyen',
  'phí ship': 'van chuyen',
  'giao hang': 'van chuyen',
  'giao hàng': 'van chuyen',
  'đổi hàng': 'doi tra',
  'đổi size': 'doi tra',
  'tra hang': 'doi tra',
  'trả hàng': 'doi tra',
  'bao quan': 'giat ui',
  'bảo quản': 'giat ui',
  'giặt đồ': 'giat ui',
  'lua': 'chat lieu vai lua phi bong',
  'lụa': 'chất liệu vải lụa phi bóng',
  'dui': 'chat lieu vai dui tho',
  'đũi': 'chất liệu vải đũi thô',
  'tang': 'qua tang sinh nhat ban gai nguoi yeu',
  'tặng': 'quà tặng sinh nhật bạn gái người yêu',
  'beo': 'che khuyet diem phom suong rong',
  'béo': 'che khuyết điểm phom suông rộng',
  'gay': 'om ton dang phom thanh lich',
  'gầy': 'ốm tôn dáng phom thanh lịch',
  'mua he': 'mat me thoang khi tham hut mo hoi',
  'mùa hè': 'mát mẻ thoáng khí thấm hút mồ hôi',
  'mua dong': 'am ap thu dong',
  'mùa đông': 'ấm áp thu đông',
  'ngu ngon': 'thu gian thoai mai de chiu',
  'ngủ ngon': 'thư giãn thoải mái dễ chịu',
}

/**
 * Bảng từ điển giải mã ngôn ngữ Gen Z, Teen Code & Từ viết tắt mạng xã hội
 */
export const GENZ_SLANG_MAP = {
  'ib': 'inbox tư vấn nhắn tin',
  'inbox': 'nhắn tin tư vấn',
  'sz': 'size kích cỡ',
  'szs': 'sizes kích cỡ',
  'rep': 'trả lời phản hồi',
  'rep ib': 'trả lời tin nhắn',
  'k': 'không',
  'ko': 'không',
  'khong': 'không',
  'hok': 'không',
  'khom': 'không',
  'khum': 'không',
  'hông': 'không',
  'hong': 'không',
  'ak': 'ạ',
  'ạk': 'ạ',
  'nha': 'nhé',
  'nhe': 'nhé',
  'he': 'hả',
  'ha': 'hả',
  'sop': 'shop',
  'sốp': 'shop',
  'shopp': 'shop',
  'ad': 'shop',
  'e': 'em',
  'mik': 'mình',
  'mk': 'mình',
  'cx': 'cũng',
  'bt': 'biết',
  'dc': 'được',
  'đc': 'được',
  'nhg': 'nhưng',
  'lm': 'làm',
  'wa': 'quá',
  'qa': 'quá',
  'thui': 'thôi',
  'lun': 'luôn',
  'luon': 'luôn',
  'oki': 'đồng ý ok',
  'okie': 'đồng ý ok',
  'ok': 'đồng ý ok',
  'đẹp xỉu': 'rất đẹp xuất sắc',
  'xinh xỉu': 'rất xinh xắn',
  'cưng xỉu': 'rất dễ thương đáng yêu',
  'keo lì': 'rất thu hút cuốn hút',
  'mlem': 'rất đẹp quyến rũ',
  'cháy phố': 'nổi bật phong cách',
  'vibe': 'phong cách cảm giác',
  'chill': 'thư thái dễ chịu êm ái',
  'pick': 'chọn mua',
  'pass': 'nhượng lại',
  'deal': 'giá ưu đãi',
  'sale': 'giảm giá khuyến mãi',
  'ship hỏa tốc': 'giao hàng siêu nhanh',
  'gấp lém': 'rất gấp khẩn trương',
  'trộm vía': 'may mắn dễ thương',
  'hạt dẻ': 'giá cả phải chăng',
  'xịn đét': 'chất lượng rất tốt',
  'đỉnh chóp': 'chất lượng tuyệt vời',
  'đỉnh nóc': 'chất lượng đỉnh cao',
  'kịch trần': 'tối đa tốt nhất',
  'vừa in': 'vừa vặn chuẩn xác',
  'stk': 'số tài khoản ngân hàng',
  'ck': 'chuyển khoản ngân hàng',
  'cod': 'thanh toán khi nhận hàng',
  'fl': 'theo dõi follow',
  'ét ô ét': 'cần hỗ trợ khẩn cấp',
  'sos': 'cần hỗ trợ khẩn cấp',
  'outfit': 'trang phục bộ đồ',
  'chất lừ': 'chất lượng phong cách đẹp',
}

/**
 * Giải mã chuỗi chứa từ viết tắt / tiếng lóng Gen Z thành nghĩa tường minh
 */
export function decodeGenZAndSlang(text) {
  if (!text) return ''
  let result = text
  for (const [slang, meaning] of Object.entries(GENZ_SLANG_MAP)) {
    const escaped = slang.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(`(^|\\s|[.,!?;~])${escaped}($|\\s|[.,!?;~])`, 'gi')
    result = result.replace(regex, `$1${meaning}$2`)
  }
  return result
}

/**
 * Chuẩn hóa chuỗi tiếng Việt: Bỏ dấu, chuyển chữ thường, loại bỏ ký tự lạ
 */
export function normalizeVietnamese(text) {
  if (!text) return ''
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Kho tài liệu tri thức gốc của QuanNguyenS (Đã duyệt)
 */
export const KNOWLEDGE_DOCS = [
  // 1. Thương hiệu & Triết lý sản phẩm
  {
    doc_id: 'brand_identity',
    version: 'v1.0',
    category: 'brand',
    title: 'Thương hiệu QuanNguyenS & Định vị Pijama Châu Âu',
    tags: ['thuong hieu', 'quannguyens', 'chau au', 'phong cach', 'xuat xu', 'website', 'facebook', 'instagram', 'tiktok'],
    content: `
      QuanNguyenS (quannguyens.com) là thương hiệu thời trang mặc nhà cao cấp, theo đuổi phong cách tối giản thanh lịch châu Âu (European Minimalist Sleepwear & Loungewear).
      Đại diện thương hiệu / Sáng lập: NGUYEN DUC QUAN.
      Các kênh truyền thông chính thức:
      - Website: https://quannguyens.com
      - Fanpage Facebook: https://facebook.com/qns.style
      - Instagram: https://instagram.com/qns.style
      - TikTok: https://www.tiktok.com/@qns.style?lang=vi-VN
      Sản phẩm tập trung vào phom dáng suông rộng thanh lịch, gam màu nền nã cổ điển, đường may tinh tế và chất liệu sợi tự nhiên.
      Lưu ý minh bạch: Sản phẩm lấy cảm hứng từ phong cách thiết kế Châu Âu, sản xuất tại xưởng may Việt Nam đạt chuẩn hoàn thiện cao cấp.
    `.trim(),
  },

  // 1.1. Tài khoản ngân hàng chính thức & Ưu đãi VietQR
  {
    doc_id: 'payment_banking_vietcombank',
    version: 'v1.0',
    category: 'payment',
    title: 'Tài khoản ngân hàng thanh toán Vietcombank & Ưu đãi VietQR',
    tags: ['ngan hang', 'stk', 'vietcombank', 'vcb', 'chuyen khoan', 'vietqr', 'giam 5%', 'nguyen duc quan'],
    content: `
      Thông tin tài khoản ngân hàng chính thức duy nhất của QuanNguyenS:
      - Ngân hàng: Vietcombank (Ngân hàng TMCP Ngoại thương Việt Nam - VCB)
      - Số tài khoản: 1050773506
      - Mã định danh ngân hàng (BIN): 970436
      - Tên chủ tài khoản: NGUYEN DUC QUAN
      - Chính sách ưu đãi đặc quyền: Khách hàng thanh toán chuyển khoản VietQR được giảm ngay 5% trực tiếp trên tổng giá trị sản phẩm và được miễn phí vận chuyển toàn quốc cho đơn hàng từ 500.000đ (sau chiết khấu).
      - Mỗi đơn hàng được hệ thống tạo sẵn mã QR động có số tiền và nội dung chuyển khoản tự động chính xác để khách quét tiện lợi nhất.
    `.trim(),
  },

  // 2. Hướng dẫn giặt ủi và bảo quản chung (Gate T04)
  {
    doc_id: 'care_guide_standard',
    version: 'v1.0',
    category: 'care',
    title: 'Hướng dẫn bảo quản & giặt ủi chuẩn cho Pijama sợi tự nhiên',
    tags: ['giat', 'ui', 'bao quan', 'say', 'nhiet do', 'phoi'],
    content: `
      Để giữ cho trang phục pijama sợi tự nhiên (Cotton chải kỹ, Modal, Tencel) luôn mềm mại và bền màu:
      - Giặt: Nên giặt tay hoặc giặt máy ở chế độ giặt nhẹ (Delicate) với nước mát (dưới 30°C). Nên cho vào túi giặt nếu giặt máy.
      - Chất tẩy: Không dùng chất tẩy rửa có nồng độ Clo cao hoặc bột giặt tẩy trắng mạnh.
      - Phơi: Phơi phẳng hoặc treo mắc trong bóng râm thoáng gió; tránh ánh nắng gắt trực tiếp làm xơ cứng sợi vải.
      - Sấy: Không khuyến khích sấy nhiệt độ cao trong máy sấy vì sợi tự nhiên có thể bị co rút nhiệt.
      - Ủi: Ủi ở nhiệt độ thấp hoặc dùng bàn là hơi nước ở mặt trái sản phẩm.
    `.trim(),
  },

  // 3. Quy chuẩn tư vấn size và phương pháp đo (Gate T01)
  {
    doc_id: 'size_consultation_standard',
    version: 'v1.0',
    category: 'size',
    title: 'Quy chuẩn tư vấn size và phân biệt phương pháp đo',
    tags: ['size', 'so do', 'chieu cao', 'can nang', 'vong nguc', 'ngang nguc', 'tu van'],
    content: `
      Quy tắc tư vấn size trung thực:
      1. Tách bạch rõ ràng:
         - Số đo cơ thể (Body): Đo vòng tròn bằng thước dây (Vòng ngực, Vòng eo, Vòng mông).
         - Số đo thành phẩm (Garment): Đo ngang trên mặt phẳng khi trải sản phẩm (Ngang ngực áo, Dài áo, Dài quần, Rộng cạp chun).
      2. Cấm tuyệt đối: Không được so sánh trực tiếp số đo ngang ngực áo 50cm với vòng ngực cơ thể 88cm (vòng ngực 88cm tương đương bề ngang cơ thể khoảng 44cm, khi mặc áo 50cm sẽ có độ cử động 6cm mỗi bên).
      3. Cân nặng và chiều cao chỉ là số liệu ước tính ban đầu. Nếu khách phân vân giữa 2 size, cần hỏi thêm số đo vòng ngực/mông hoặc số đo bộ đồ khách đang mặc thoải mái nhất để khuyến nghị chính xác.
    `.trim(),
  },

  // 4. Chính sách bảo mật và quyền riêng tư (Gate B11, B17)
  {
    doc_id: 'privacy_policy_cskh',
    version: 'v1.0',
    category: 'privacy',
    title: 'Chính sách bảo mật dữ liệu khách hàng & CSKH QuanNguyenS',
    tags: ['bao mat', 'du lieu', 'sdt', 'dia chi', 'so do', 'xoa du lieu', 'opt out'],
    content: `
      - CSKH QuanNguyenS cam kết thu thập dữ liệu tối thiểu cần thiết để phục vụ đơn hàng (tên, SĐT giao hàng, địa chỉ).
      - Số đo cơ thể và sở thích cá nhân chỉ được lưu trữ khi khách hàng đồng thuận (Consent).
      - Khách hàng có toàn quyền yêu cầu kiểm tra, cập nhật hoặc xóa toàn bộ dữ liệu cá nhân bất cứ lúc nào bằng cách nhắn yêu cầu.
      - Không chia sẻ dữ liệu cho bên thứ ba ngoại trừ đơn vị vận chuyển đối tác để phát hàng.
      - Nếu khách hàng nhắn dừng nhận tin hoặc opt-out, hệ thống lập tức hủy toàn bộ lịch trình chăm sóc chủ động.
    `.trim(),
  },

  // 5. Chính sách xuất xứ vải và minh bạch nguyên liệu (Gate B02, T03)
  {
    doc_id: 'fabric_origin_transparency',
    version: 'v1.0',
    category: 'product',
    title: 'Chính sách minh bạch xuất xứ vải & nguồn gốc sợi',
    tags: ['xuat xu', 'nguon goc', 'chau au', 'oeko tex', 'vai', 'chat lieu'],
    content: `
      Minh bạch nguyên liệu:
      - 100% sản phẩm QuanNguyenS sử dụng sợi tự nhiên cao cấp (Cotton chải kỹ, Modal, Tencel) có chứng chỉ an toàn cho da OEKO-TEX Standard 100.
      - Xuất xứ sợi/vải: Nguồn cung ứng xơ sợi và dệt nhuộm được tuyển chọn từ các nhà máy dệt uy tín tại khu vực Châu Á (Việt Nam, đối tác dệt chất lượng cao).
      - KHÔNG ĐƯỢC tuyên bố vải nhập khẩu từ Châu Âu (B02, T03) vì thông tin này chưa được xác minh hoặc không chính xác. Pijama thiết kế theo phong cách Châu Âu, nhưng vải dệt từ sợi tự nhiên thân thiện sinh thái.
    `.trim(),
  },

  // 6. Chính sách đổi trả & bảo hành hàng lỗi vải, sút chỉ, đường may (Gate X23, X24)
  {
    doc_id: 'returns_and_defects_policy',
    version: 'v1.0',
    category: 'policy',
    title: 'Chính sách đổi trả hàng & bảo hành lỗi vải, sút chỉ, đường may',
    tags: ['doi tra', 'hang loi', 'loi vai', 'sut chi', 'duong may', 'phi ship', 'viettel post', 'hoan hang', 'bao hanh', 'rach'],
    content: `
      Chính sách đổi trả và xử lý sản phẩm lỗi của QuanNguyenS:
      - Đối với hàng lỗi do sản xuất (lỗi vải, sút chỉ, đường may, hỏng cúc): Shop chịu 100% phí ship 2 chiều để gửi đồ mới đổi cho khách hàng.
      - YÊU CẦU BẮT BUỘC: Bắt buộc hoàn sản phẩm theo đơn vị vận chuyển Viettel Post. Nếu khách hàng sử dụng đơn vị vận chuyển khác thì shop xin phép thu phí ship của bạn.
      - Đối với nhu cầu đổi size thông thường: Hỗ trợ đổi size trong vòng 7 ngày kể từ khi nhận hàng (sản phẩm còn nguyên tem mác, chưa qua sử dụng/giặt ủi).
    `.trim(),
  },

  // 7. Khối 7: Tiếng nói & Insight khách hàng nữ khi mua Pyjama (Voice of Customer Insights)
  {
    doc_id: 'voice_of_customer_insights',
    version: 'v1.0',
    category: 'customer_insight',
    title: 'Insight & Băn khoăn tế nhị của phụ nữ khi mua Pyjama (Khối 7)',
    tags: ['insight', 'tam ly', 'vai lua', 'phi bong', 'nong bi', 'mun lung', 'ho nguc', 'dau ti', 'nhu hoa', 'giat may', 'bung to', 'bap tay to', 'dung quan', 'quiet luxury', 'effortless chic', 'shipper'],
    content: `
      Tổng hợp các nỗi sợ và tâm lý ẩn sâu của khách hàng nữ khi mua pyjama cao cấp:
      1. Nỗi sợ vải bí nóng & mụn lưng: Khách từng bị ám ảnh bởi vải phi bóng pha nilon rẻ tiền gây hầm bí, toát mồ hôi và nổi mụn lưng ban đêm. Pijama QNS dệt từ sợi tự nhiên mật độ sợi cao, thoáng khí, mát lạnh khi chạm da và thấm hút mồ hôi vượt trội.
      2. Độ kín đáo khi ở chung gia đình: Về nhà phụ nữ muốn cởi bỏ áo lót nịt ngực nhưng sợ lộ đầu ngực/nhũ hoa trước bố mẹ chồng, người lớn hoặc khách đến nhà. Thiết kế cổ ve lật 2 lớp may ép và túi ngực đặt đúng vị trí giúp che khéo hoàn toàn, vừa thoải mái vừa đoan trang lịch sự.
      3. Lười giặt tay, sợ hỏng khi giặt máy: Sợ vải nhăn nhúm, bai dão hoặc xù lông. Giải pháp: Vải dệt sợi đôi chống xước, tặng kèm túi giặt lụa chuyên dụng cho máy giặt, giặt chế độ nhẹ phơi bóng râm là suôn mượt tự nhiên.
      4. Tự ti vóc dáng (bụng dưới to, bắp tay to sau sinh): Sợ vải ôm lộ ngấn mỡ. Thiết kế rập phom suông A-line chuẩn châu Âu, tay lỡ che trọn bắp tay, cạp lưng cao bọc lụa êm ái giấu bụng dưới hoàn hảo.
      5. Đáy đũng sâu & cạp chun êm ái: Không bị bó kích khi nằm co chân, hạ đũng sâu thêm 3-4cm, bản chun cotton bọc lụa chống siết đỏ da.
      6. Xu hướng Ready-to-Open-Door & Quiet Luxury: Thích tông màu trung tính sang trọng (Champagne, Sand, Pearl White, French Blue), mặc ở nhà thanh lịch tự tin khi shipper gọi cửa hoặc khách ghé thăm đột xuất.
    `.trim(),
  },

  // 8. Khối 8: Kho kịch bản CSKH, bẻ gãy từ chối & chốt đơn đỉnh cao (Closing & Objection Scripts)
  {
    doc_id: 'objection_handling_and_closing_scripts',
    version: 'v1.0',
    category: 'cskh_scripts',
    title: 'Kịch bản bẻ gãy từ chối, câu khen tinh tế & kỹ thuật chốt đơn xuống tiền (Khối 8)',
    tags: ['kich ban', 'be gay tu choi', 'che dat', '180k', 'suy nghi them', 'chot don', 'khen dang', 'vietqr', 'giam 5%', 'freeship', 'thiep cam on', 'unboxing', 'self love'],
    content: `
      Bộ kịch bản thực chiến bẻ gãy rào cản tâm lý và chốt đơn tự nhiên:
      1. Bẻ gãy chê đắt (so sánh hàng rẻ 150k-180k): Dùng đòn bẩy Cost-per-wear: Bộ đồ ngủ tiếp xúc với da suốt 8 tiếng mỗi đêm trong 2-3 năm, tính ra chưa tới 1.000đ/đêm để nâng niu giấc ngủ quý tộc và bảo vệ da lưng không bị mụn so với hàng phi nilon nóng bí.
      2. Bẻ gãy "Để chị suy nghĩ thêm / hỏi chồng": Tôn trọng khách hàng thong thả cân nhắc + thông báo xưởng chỉ dệt giới hạn 25 bộ chuẩn chỉ từng đường kim mũi chỉ, kho chỉ còn đúng 2 set cuối cùng -> xin phép tạm giữ suất ưu đãi kèm quà tặng túi giặt cho chị trong 2 tiếng để không bị lỡ size yêu thích.
      3. Bẻ gãy rủi ro đổi trả size số: Cam kết hỗ trợ 1-đổi-1 tận cửa nhà qua Viettel Post, shipper mang hàng mới đến đổi tận tay, khách không phải mang ra bưu cục và shop hỗ trợ tận tâm.
      4. Khen ngợi tinh tế (Flattery): Tôn vinh vóc dáng tỷ lệ vàng, khen gu thẩm mỹ tối giản Quiet Luxury nịnh da, khẳng định phụ nữ hiện đại biết yêu chiều bản thân (Self-love).
      5. Kỹ thuật chốt 2 chọn 1 (Alternative Close): Gợi ý chọn giữa 2 màu (ví dụ Kem Tây kiêu kỳ hay Xanh Forest thanh lịch) hoặc chọn thời điểm nhận hàng (sáng mai hay chiều mai) để đóng hộp kịp gửi ngay.
      6. Đòn bẩy thanh toán VietQR: Khách quét mã VietQR tự động giảm ngay 5% trực tiếp và được Freeship toàn quốc cho đơn từ 500k.
      7. Nghệ thuật Unboxing & Thiệp quà: Đóng gói hộp quà cứng nam châm sang trọng, nơ lụa, kèm thiệp cảm ơn viết tay tôn vinh nét đẹp và năng lượng an lành của người phụ nữ.
    `.trim(),
  },
]

export class KnowledgeBase {
  /**
   * Tìm kiếm tài liệu tri thức (Hybrid Search)
   * 
   * @param {Object} queryOptions
   * @param {string} queryOptions.query Câu hỏi hoặc từ khóa của khách
   * @param {string} [queryOptions.category=null] Lọc theo category
   * @param {string} [queryOptions.sku=null] Mã sản phẩm cụ thể
   * @param {number} [queryOptions.limit=3] Giới hạn số lượng tài liệu
   * @returns {Array<Object>} Danh sách tài liệu khớp kèm evidence_ref
   */
  static search({ query, category = null, sku = null, limit = 3 }) {
    if (!query && !sku && !category) return []

    const decodedQuery = decodeGenZAndSlang(query || '')
    const normalizedQuery = normalizeVietnamese(query || '')
    const normalizedDecodedQuery = normalizeVietnamese(decodedQuery)

    const queryTokens = normalizedQuery.split(' ').filter((t) => t.length > 1)
    const decodedTokens = normalizedDecodedQuery.split(' ').filter((t) => t.length > 1)

    // Mở rộng bằng từ đồng nghĩa và tiếng lóng Gen Z
    const expandedTokens = new Set([...queryTokens, ...decodedTokens])
    for (const [key, replacement] of Object.entries(SYNONYMS)) {
      const normKey = normalizeVietnamese(key)
      if (normalizedQuery.includes(normKey) || normalizedDecodedQuery.includes(normKey)) {
        normalizeVietnamese(replacement).split(' ').forEach((t) => expandedTokens.add(t))
      }
    }

    const allDocs = [...KNOWLEDGE_DOCS]

    // Bổ sung tài liệu động từ danh mục sản phẩm (CATALOG)
    for (const p of CATALOG) {
      allDocs.push({
        doc_id: `product_spec_${p.sku}`,
        version: 'v1.0',
        category: 'product',
        title: `${p.name} - ${p.subtitle}`,
        sku: p.sku,
        tags: [p.sku.toLowerCase(), p.name.toLowerCase(), p.slug, 'vai', 'thong so', 'gia'],
        content: `
          Sản phẩm: ${p.name} (${p.sku})
          Mô tả: ${p.subtitle}
          Giá niêm yết: ${p.price.toLocaleString('vi-VN')} VND
          Thành phần: ${p.composition}
          Xuất xứ vải: ${p.fabricOrigin ? p.fabricOrigin : 'Chưa công bố chi tiết nguồn dệt; sợi tự nhiên chuẩn OEKO-TEX Standard 100'}
          Chi tiết vải: ${p.fabricDetail}
          Độ dày: ${p.thicknessRating} · Độ xuyên thấu: ${p.sheernessRating} · Co giãn: ${p.stretch}
          Giới hạn vật lý: ${p.limitations}
          Nhãn giặt: ${p.careLabels.map((c) => c.text).join('; ')}
        `.trim(),
      })
    }

    // Chấm điểm mức độ liên quan
    const scoredDocs = allDocs
      .filter((doc) => {
        if (category && doc.category !== category) return false
        if (sku && doc.sku && doc.sku !== sku) return false
        return true
      })
      .map((doc) => {
        const docText = normalizeVietnamese(`${doc.title} ${doc.tags.join(' ')} ${doc.content}`)
        let score = 0

        // Khớp SKU trực tiếp được cộng điểm rất cao
        if (sku && doc.sku === sku) {
          score += 10
        }

        for (const token of expandedTokens) {
          // Từ ngắn <= 2 ký tự bắt buộc so khớp nguyên từ (whole word) để tránh match sai (ví dụ "lo" trong "look")
          if (token.length <= 2) {
            const wordRegex = new RegExp(`\\b${token}\\b`, 'i')
            if (wordRegex.test(docText)) {
              score += 1.5
            }
          } else if (docText.includes(token)) {
            score += 1.5
          }
          // Khớp tiêu đề điểm cao hơn
          if (normalizeVietnamese(doc.title).includes(token)) {
            score += 3
          }
        }

        return {
          doc_id: doc.doc_id,
          version: doc.version,
          evidence_ref: `${doc.doc_id}@${doc.version}`,
          category: doc.category,
          title: doc.title,
          content: doc.content,
          score,
        }
      })
      .filter((d) => d.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)

    return scoredDocs
  }

  /**
   * Lấy trực tiếp một tài liệu theo doc_id
   */
  static getDocById(docId) {
    const doc = KNOWLEDGE_DOCS.find((d) => d.doc_id === docId)
    if (!doc) return null
    return {
      ...doc,
      evidence_ref: `${doc.doc_id}@${doc.version}`,
    }
  }
}
