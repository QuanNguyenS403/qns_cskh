/**
 * STANDARDIZED PRODUCT CATALOG (Blueprint §9, §16.2, Prompt A Phase 1)
 * Chuẩn hóa theo SKU và biến thể:
 * - Thành phần, độ dày, độ xuyên thấu, co giãn, nhãn giặt chuẩn.
 * - Tách bạch rõ số đo cơ thể (body) và số đo thành phẩm (garment), phương pháp đo (flat vs circumference).
 * - Trường thiếu = null (B02: Agent bị chặn không được tự lấp).
 */

export const CATALOG = [
  {
    sku: 'QNS-DAYBREAK-SET',
    id: 'the-classic-set',
    slug: 'the-classic-set',
    name: 'The Classic Set (Daybreak)',
    websiteName: 'The Classic Set',
    subtitle: 'Pijama Phong Cách Châu Âu · Sọc Hồng Nắng Sớm',
    collection: 'Thu Đông 2026',
    price: 390000,
    originalPrice: 490000,
    currency: 'VND',
    badge: 'MỚI RA MẮT',
    
    // Thuộc tính vật lý chuẩn hóa (D2: Các chứng chỉ/thông số chưa kiểm chứng = null)
    composition: '100% Sợi Tự Nhiên Cao Cấp (Natural Plant-Based Cotton-Modal Blend)',
    fabricOrigin: null, // CHƯA XÁC MINH = null, không bịa xuất xứ châu Âu
    fabricDetail: 'Dệt thoi vân chéo thoáng khí 4 mùa · Thoáng mát mềm mại',
    gsm: null,
    oekoTex: null,
    thicknessRating: 'medium', // thin | medium | thick
    sheernessRating: 'opaque', // opaque (kín) | slightly_sheer | sheer
    stretch: 'none', // none (không co giãn) | mechanical | 2-way | 4-way
    
    // Nhãn giặt chuẩn ký hiệu
    careLabels: [
      { code: 'WASH_30C_GENTLE', text: 'Giặt máy chế độ nhẹ (delicate) hoặc giặt tay, nhiệt độ tối đa 30°C' },
      { code: 'DO_NOT_BLEACH', text: 'Không sử dụng thuốc tẩy hoặc chất giặt rửa mạnh' },
      { code: 'DRY_LINE_SHADE', text: 'Phơi trong bóng mát, tránh ánh nắng gắt trực tiếp' },
      { code: 'DO_NOT_TUMBLE_DRY', text: 'Không sử dụng máy sấy nhiệt độ cao' },
      { code: 'IRON_LOW', text: 'Ủi ở nhiệt độ thấp (tối đa 110°C) nếu cần' },
    ],

    // Biến thể màu sắc & tồn kho
    variants: [
      {
        colorCode: 'pink_stripe',
        colorLabel: 'Sọc Hồng',
        hex: '#EFAEA0',
        sizes: [
          { size: 'S', stock: 10, available: true },
          { size: 'M', stock: 8, available: true },
        ],
      },
    ],

    // Bảng đo chuẩn hóa: TÁCH BẠCH số đo cơ thể vs số đo thành phẩm
    sizeChart: {
      unit: 'cm',
      measurementMethod: 'flat_and_circumference',
      bodyMeasurements: {
        description: 'Số đo cơ thể người mặc tham khảo (Đo vòng thước dây)',
        S: { weight: '40–49 kg', height: '150–160 cm', chest: '82–88 cm', waist: '62–70 cm', hips: '86–92 cm' },
        M: { weight: '50–58 kg', height: '158–168 cm', chest: '89–95 cm', waist: '71–78 cm', hips: '93–98 cm' },
      },
      garmentMeasurements: {
        description: 'Số đo thành phẩm thực tế của bộ đồ (Trải phẳng trên mặt bàn, đo ngang)',
        measurementType: 'flat', // Đo ngang phẳng
        S: { shirtLength: '64 cm', chestWidthFlat: '49 cm', sleeveLength: '53.5 cm', pantsLength: '90 cm', waistFlat: '32–42 cm' },
        M: { shirtLength: '66 cm', chestWidthFlat: '52 cm', sleeveLength: '54.5 cm', pantsLength: '92 cm', waistFlat: '34–45 cm' },
      },
    },

    // Giới hạn vật lý trung thực (Blueprint §9.4, B16)
    limitations: 'Phom suông thoải mái. Vải dệt thoi sợi tự nhiên không co giãn nên cần chọn đúng bảng đo ngang ngực áo.',
  },

  {
    sku: 'QNS-STILLWATER-SET',
    id: 'the-cafe-look',
    slug: 'the-cafe-look',
    name: 'The Café Look (Stillwater)',
    websiteName: 'The Café Look',
    subtitle: 'Pijama Phong Cách Châu Âu · Caro Navy Cổ Điển',
    collection: 'Thu Đông 2026',
    price: 550000,
    originalPrice: 650000,
    currency: 'VND',
    badge: 'BEST SELLER',
    
    composition: '100% Sợi Tự Nhiên Cao Cấp (Modal & Tencel Blend)',
    fabricOrigin: null,
    fabricDetail: 'Dệt mịn bề mặt óng nhẹ tự nhiên · Mát mịn thân thiện da',
    gsm: null,
    oekoTex: null,
    thicknessRating: 'medium',
    sheernessRating: 'opaque',
    stretch: 'mechanical',
    
    careLabels: [
      { code: 'WASH_30C_GENTLE', text: 'Giặt nhẹ nước mát 30°C' },
      { code: 'DO_NOT_BLEACH', text: 'Không dùng chất tẩy mạnh' },
      { code: 'DRY_LINE_SHADE', text: 'Phơi trong bóng râm' },
      { code: 'DO_NOT_TUMBLE_DRY', text: 'Không sấy máy' },
      { code: 'IRON_LOW', text: 'Ủi bàn là hơi nước ở nhiệt độ thấp' },
    ],

    variants: [
      {
        colorCode: 'caro_navy',
        colorLabel: 'Caro Navy',
        hex: '#1E293B',
        sizes: [
          { size: 'S', stock: 12, available: true },
          { size: 'L', stock: 6, available: true }, // M hiện đang hết hàng
        ],
      },
    ],

    sizeChart: {
      unit: 'cm',
      measurementMethod: 'flat_and_circumference',
      bodyMeasurements: {
        description: 'Số đo cơ thể người mặc tham khảo (Đo vòng thước dây)',
        S: { weight: '40–49 kg', height: '150–160 cm', chest: '82–88 cm', waist: '62–70 cm', hips: '86–92 cm' },
        L: { weight: '59–68 kg', height: '162–172 cm', chest: '96–104 cm', waist: '79–88 cm', hips: '99–106 cm' },
      },
      garmentMeasurements: {
        description: 'Số đo thành phẩm thực tế của bộ đồ (Trải phẳng trên mặt bàn, đo ngang)',
        measurementType: 'flat',
        S: { shirtLength: '65 cm', chestWidthFlat: '50 cm', sleeveLength: '54 cm', pantsLength: '91 cm', waistFlat: '32–42 cm' },
        L: { shirtLength: '69 cm', chestWidthFlat: '56 cm', sleeveLength: '56 cm', pantsLength: '95 cm', waistFlat: '37–48 cm' },
      },
    },

    limitations: 'Màu Caro Navy tối màu, nên giặt riêng trong lần giặt đầu tiên.',
  },

  {
    sku: 'QNS-HEARTH-SET',
    id: 'the-evening-edit',
    slug: 'the-evening-edit',
    name: 'The Evening Edit (Hearth)',
    websiteName: 'The Evening Edit',
    subtitle: 'Pijama Phong Cách Châu Âu · Sọc Nâu Ấm Áp',
    collection: 'Thu Đông 2026',
    price: 750000,
    originalPrice: 850000,
    currency: 'VND',
    badge: 'CAO CẤP',
    
    composition: '100% Sợi Tự Nhiên Cao Cấp (Modal & Cotton chải kỹ cao cấp)',
    fabricOrigin: null,
    fabricDetail: 'Dệt đầm tay êm ái, giữ nhiệt tốt cho tiết trời se lạnh hoặc phòng điều hòa',
    gsm: null,
    oekoTex: null,
    thicknessRating: 'thick',
    sheernessRating: 'opaque',
    stretch: 'mechanical',
    
    careLabels: [
      { code: 'WASH_30C_GENTLE', text: 'Giặt nhẹ tối đa 30°C' },
      { code: 'DO_NOT_BLEACH', text: 'Không dùng chất tẩy' },
      { code: 'DRY_LINE_SHADE', text: 'Phơi ngang trong bóng mát' },
      { code: 'DO_NOT_TUMBLE_DRY', text: 'Không sấy máy nhiệt độ cao' },
      { code: 'IRON_LOW', text: 'Ủi mặt trái ở nhiệt độ thấp' },
    ],

    variants: [
      {
        colorCode: 'brown_stripe',
        colorLabel: 'Sọc Nâu',
        hex: '#78350F',
        sizes: [
          { size: 'S', stock: 5, available: true },
          { size: 'M', stock: 4, available: true },
        ],
      },
    ],

    sizeChart: {
      unit: 'cm',
      measurementMethod: 'flat_and_circumference',
      bodyMeasurements: {
        description: 'Số đo cơ thể người mặc tham khảo (Đo vòng thước dây)',
        S: { weight: '40–49 kg', height: '150–160 cm', chest: '82–88 cm', waist: '62–70 cm', hips: '86–92 cm' },
        M: { weight: '50–58 kg', height: '158–168 cm', chest: '89–95 cm', waist: '71–78 cm', hips: '93–98 cm' },
      },
      garmentMeasurements: {
        description: 'Số đo thành phẩm thực tế của bộ đồ (Trải phẳng trên mặt bàn, đo ngang)',
        measurementType: 'flat',
        S: { shirtLength: '66 cm', chestWidthFlat: '51 cm', sleeveLength: '54 cm', pantsLength: '91 cm', waistFlat: '32–42 cm' },
        M: { shirtLength: '68 cm', chestWidthFlat: '54 cm', sleeveLength: '55 cm', pantsLength: '93 cm', waistFlat: '35–46 cm' },
      },
    },

    limitations: 'Chất vải 190 GSM đầm ấm phù hợp mùa thu đông hoặc phòng điều hòa; không phù hợp mặc giữa trưa hè nắng nóng.',
  },
]

export function getProductBySkuOrSlug(query) {
  if (!query) return null
  const q = String(query).toLowerCase().trim()
  return CATALOG.find(
    (p) =>
      p.sku.toLowerCase() === q ||
      p.id.toLowerCase() === q ||
      p.slug.toLowerCase() === q ||
      p.name.toLowerCase().includes(q) ||
      (p.websiteName && p.websiteName.toLowerCase().includes(q))
  ) || null
}

export function searchCatalog({ keyword = null, maxPrice = null, size = null }) {
  return CATALOG.filter((p) => {
    if (keyword) {
      const k = keyword.toLowerCase()
      const match =
        p.name.toLowerCase().includes(k) ||
        p.subtitle.toLowerCase().includes(k) ||
        p.composition.toLowerCase().includes(k)
      if (!match) return false
    }

    if (maxPrice && p.price > maxPrice) {
      return false
    }

    if (size) {
      const hasSize = p.variants.some((v) =>
        v.sizes.some((s) => s.size.toUpperCase() === size.toUpperCase() && s.available)
      )
      if (!hasSize) return false
    }

    return true
  })
}
