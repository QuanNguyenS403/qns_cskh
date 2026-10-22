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
    tags: ['thuong hieu', 'quannguyens', 'chau au', 'phong cach', 'xuat xu'],
    content: `
      QuanNguyenS (quannguyens.com) là thương hiệu thời trang mặc nhà cao cấp, theo đuổi phong cách tối giản thanh lịch châu Âu (European Minimalist Sleepwear & Loungewear).
      Sứ mệnh: Mang lại cảm giác thoải mái trọn vẹn và tự tin ngay tại không gian riêng tư.
      Sản phẩm tập trung vào phom dáng suông rộng thanh lịch, gam màu nền nã cổ điển, đường may tinh tế và chất liệu sợi tự nhiên.
      Lưu ý minh bạch: Sản phẩm lấy cảm hứng từ phong cách thiết kế Châu Âu, sản xuất tại xưởng may Việt Nam đạt chuẩn hoàn thiện cao cấp.
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
    title: 'Chính sách bảo mật dữ liệu khách hàng & CSKH May',
    tags: ['bao mat', 'du lieu', 'sdt', 'dia chi', 'so do', 'xoa du lieu', 'opt out'],
    content: `
      - CSKH May cam kết thu thập dữ liệu tối thiểu cần thiết để phục vụ đơn hàng (tên, SĐT giao hàng, địa chỉ).
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

    const normalizedQuery = normalizeVietnamese(query || '')
    const queryTokens = normalizedQuery.split(' ').filter((t) => t.length > 1)

    // Mở rộng bằng từ đồng nghĩa
    const expandedTokens = new Set(queryTokens)
    for (const [key, replacement] of Object.entries(SYNONYMS)) {
      const normKey = normalizeVietnamese(key)
      if (normalizedQuery.includes(normKey)) {
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
          if (docText.includes(token)) {
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
