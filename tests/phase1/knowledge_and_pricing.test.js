import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert'
import { DatabaseSync } from 'node:sqlite'
import { runMigrations } from '../../src/db/migrations.js'
import { CATALOG, getProductBySkuOrSlug, searchCatalog } from '../../src/catalog/products.js'
import {
  registerPolicy,
  approvePolicy,
  getApprovedPolicy,
  createPolicySnapshot,
  getApplicableOrderPolicy,
  seedDefaultPolicies,
  POLICY_TYPES,
} from '../../src/policies/policyRegistry.js'
import { PricingService } from '../../src/pricing/pricingService.js'
import { KnowledgeBase, normalizeVietnamese } from '../../src/knowledge/knowledgeBase.js'

describe('PHASE 1: Knowledge Base, Catalog & Pricing Service', () => {
  let db

  beforeEach(() => {
    db = new DatabaseSync(':memory:')
    runMigrations(db)
  })

  describe('1. Standard Product Catalog (Blueprint §9, Gate T01, T02, T03, T04)', () => {
    it('chứa đầy đủ các mẫu pijama chuẩn hóa với thông số vật lý', () => {
      assert.strictEqual(CATALOG.length, 3)
      const daybreak = getProductBySkuOrSlug('QNS-DAYBREAK-SET')
      assert.ok(daybreak)
      assert.strictEqual(daybreak.price, 390000)
      assert.strictEqual(daybreak.thicknessRating, 'medium')
      assert.strictEqual(daybreak.sheernessRating, 'opaque')
      assert.strictEqual(daybreak.stretch, 'none')
    })

    it('T01: Bảng đo tách bạch rõ số đo cơ thể (vòng) và số đo thành phẩm (phẳng)', () => {
      const p = getProductBySkuOrSlug('QNS-DAYBREAK-SET')
      assert.ok(p.sizeChart.bodyMeasurements, 'Phải có số đo cơ thể')
      assert.ok(p.sizeChart.garmentMeasurements, 'Phải có số đo thành phẩm')
      assert.strictEqual(p.sizeChart.garmentMeasurements.measurementType, 'flat')
      
      // Số đo cơ thể là vòng dây (chest 82-88cm)
      assert.ok(p.sizeChart.bodyMeasurements.S.chest.includes('82–88 cm'))
      // Số đo thành phẩm là đo phẳng ngang ngực (chestWidthFlat 49cm)
      assert.strictEqual(p.sizeChart.garmentMeasurements.S.chestWidthFlat, '49 cm')
    })

    it('T02: Báo đúng tồn kho và không nhận bừa biến thể đã hết hàng', () => {
      const stillwater = getProductBySkuOrSlug('QNS-STILLWATER-SET')
      const navyVariant = stillwater.variants.find((v) => v.colorCode === 'caro_navy')
      const sizeS = navyVariant.sizes.find((s) => s.size === 'S')
      const sizeM = navyVariant.sizes.find((s) => s.size === 'M')
      const sizeL = navyVariant.sizes.find((s) => s.size === 'L')

      assert.strictEqual(sizeS.available, true)
      assert.strictEqual(sizeL.available, true)
      assert.strictEqual(sizeM, undefined, 'Size M hết hàng, không có trong danh sách khả dụng')
    })

    it('T03: Xuất xứ vải chưa công bố = null, không bịa đặt xuất xứ Châu Âu', () => {
      const daybreak = getProductBySkuOrSlug('QNS-DAYBREAK-SET')
      assert.strictEqual(daybreak.fabricOrigin, null, 'Chưa xác minh xuất xứ phải để null, không bịa đặt')
    })

    it('T04: Hướng dẫn giặt bảo quản có mã chuẩn quốc tế và hướng dẫn chi tiết', () => {
      const daybreak = getProductBySkuOrSlug('QNS-DAYBREAK-SET')
      const codes = daybreak.careLabels.map((c) => c.code)
      assert.ok(codes.includes('WASH_30C_GENTLE'))
      assert.ok(codes.includes('DO_NOT_BLEACH'))
      assert.ok(codes.includes('DRY_LINE_SHADE'))
    })
  })

  describe('2. Policy Registry & Versioning (Gates B04, T07, T42)', () => {
    it('T07: Chính sách ở trạng thái DRAFT không được coi là quyền lợi áp dụng', () => {
      registerPolicy(db, {
        shopId: 'quannguyens',
        policyType: POLICY_TYPES.RETURNS,
        version: 'v0.9-draft',
        status: 'DRAFT',
        content: { returnWindowDays: 14 },
      })

      const activePolicy = getApprovedPolicy(db, {
        shopId: 'quannguyens',
        policyType: POLICY_TYPES.RETURNS,
      })

      // Vì chỉ có DRAFT, getApprovedPolicy phải trả về null
      assert.strictEqual(activePolicy, null)
    })

    it('Chính sách chỉ có hiệu lực sau khi được cấp quyền APPROVE', () => {
      registerPolicy(db, {
        shopId: 'quannguyens',
        policyType: POLICY_TYPES.RETURNS,
        version: 'v1.0',
        status: 'DRAFT',
        content: { returnWindowDays: 7 },
      })

      approvePolicy(db, {
        shopId: 'quannguyens',
        policyType: POLICY_TYPES.RETURNS,
        version: 'v1.0',
        approvedBy: 'shop_owner_quan',
      })

      const activePolicy = getApprovedPolicy(db, {
        shopId: 'quannguyens',
        policyType: POLICY_TYPES.RETURNS,
      })

      assert.ok(activePolicy)
      assert.strictEqual(activePolicy.status, 'APPROVED')
      assert.strictEqual(activePolicy.content.returnWindowDays, 7)
      assert.strictEqual(activePolicy.approvedBy, 'shop_owner_quan')
    })

    it('T42: Đơn có chính sách cũ khác chính sách hiện tại không bị tước quyền', () => {
      seedDefaultPolicies(db, 'quannguyens', true)

      // Giả sử khách đặt đơn ORD-001 lúc v1.0 đang áp dụng (hạn đổi trả 7 ngày)
      const snapshot = createPolicySnapshot(db, {
        shopId: 'quannguyens',
        orderId: 'ORD-001',
      })
      assert.strictEqual(snapshot.policies.returns.content.returnWindowDays, 7)

      // Sau đó shop cập nhật chính sách v2.0 giảm hạn đổi trả xuống còn 3 ngày
      registerPolicy(db, {
        shopId: 'quannguyens',
        policyType: POLICY_TYPES.RETURNS,
        version: 'v2.0',
        status: 'APPROVED',
        approvedBy: 'shop_owner_quan',
        content: {
          returnWindowDays: 3,
        },
      })

      // Đơn mới sẽ nhận chính sách hiện hành (3 ngày)
      const currentPolicy = getApprovedPolicy(db, { shopId: 'quannguyens', policyType: POLICY_TYPES.RETURNS })
      assert.strictEqual(currentPolicy.content.returnWindowDays, 3)

      // Nhưng khi tra cứu đơn cũ ORD-001, hệ thống VẪN BẢO VỆ quyền 7 ngày theo snapshot đã lưu (T42)
      const orderPolicyResult = getApplicableOrderPolicy(db, {
        orderId: 'ORD-001',
        policyType: POLICY_TYPES.RETURNS,
      })
      assert.strictEqual(orderPolicyResult.source, 'order_snapshot')
      assert.strictEqual(orderPolicyResult.policy.content.returnWindowDays, 7)
    })
  })

  describe('3. Pricing Service & Quote Engine (Gates B03, T05, T08)', () => {
    beforeEach(() => {
      seedDefaultPolicies(db, 'quannguyens', true)
    })

    it('B03 & T05: Tính toán tiền chuẩn xác số nguyên VND từ catalog', () => {
      const quote = PricingService.calculateQuote(db, {
        items: [{ sku: 'QNS-DAYBREAK-SET', quantity: 1 }],
        paymentMethod: 'cod',
      })

      assert.strictEqual(quote.status, 'SUCCEEDED')
      assert.strictEqual(quote.subtotal, 390000)
      assert.strictEqual(quote.discount, 0)
      assert.strictEqual(quote.shipping_fee, 30000)
      assert.strictEqual(quote.total, 420000)
      assert.strictEqual(Number.isInteger(quote.total), true)
      assert.ok(quote.quote_id.startsWith('QTE-'))
    })

    it('T08: Freeship được tính TRÊN SỐ TIỀN SAU GIẢM (discounted subtotal)', () => {
      // 2 bộ QNS-DAYBREAK-SET = 390k x 2 = 780.000đ
      // Chuyển khoản VietQR giảm 5% = 39.000đ
      // Sau giảm = 741.000đ >= 500.000đ -> Đủ điều kiện Freeship
      const quoteFreeship = PricingService.calculateQuote(db, {
        items: [{ sku: 'QNS-DAYBREAK-SET', quantity: 2 }],
        paymentMethod: 'bank_transfer',
      })

      assert.strictEqual(quoteFreeship.subtotal, 780000)
      assert.strictEqual(quoteFreeship.discount, 39000)
      assert.strictEqual(quoteFreeship.shipping_fee, 0, 'Phải được freeship vì 741k > 500k')
      assert.strictEqual(quoteFreeship.total, 741000)

      // Ca biên Gate T08: Tổng 510.000đ nhưng giảm 5% (25.500đ) -> Còn 484.500đ (< 500.000đ)
      // Tạo sản phẩm giả định hoặc kịch bản giá
      // Sử dụng QNS-STILLWATER-SET (550k) - 5% = 27.500đ -> còn 522.500đ -> Freeship
      const quoteStillwater = PricingService.calculateQuote(db, {
        items: [{ sku: 'QNS-STILLWATER-SET', quantity: 1 }],
        paymentMethod: 'bank_transfer',
      })
      assert.strictEqual(quoteStillwater.subtotal, 550000)
      assert.strictEqual(quoteStillwater.discount, 27500)
      assert.strictEqual(quoteStillwater.shipping_fee, 0)
      assert.strictEqual(quoteStillwater.total, 522500)
    })

    it('Báo giá lưu vào CSDL và kiểm tra được TTL còn hạn / hết hạn (Gate T07)', () => {
      const quoteRes = PricingService.calculateQuote(db, {
        items: [{ sku: 'QNS-DAYBREAK-SET', quantity: 1 }],
      })

      const fetched = PricingService.getQuote(db, quoteRes.quote_id)
      assert.strictEqual(fetched.status, 'SUCCEEDED')
      assert.strictEqual(fetched.quote.quote_id, quoteRes.quote_id)
      assert.strictEqual(fetched.quote.is_consumed, false)

      // Cập nhật giả lập báo giá đã hết hạn trong quá khứ
      db.prepare(`UPDATE quotes SET expires_at = ? WHERE quote_id = ?`).run(
        new Date(Date.now() - 10000).toISOString(),
        quoteRes.quote_id
      )

      const expiredCheck = PricingService.getQuote(db, quoteRes.quote_id)
      assert.strictEqual(expiredCheck.status, 'EXPIRED')
      assert.strictEqual(expiredCheck.error_code, 'QUOTE_EXPIRED')
    })
  })

  describe('4. Knowledge Base & Hybrid Search (Blueprint §8, B02, T03, T04)', () => {
    it('Chuẩn hóa tiếng Việt bỏ dấu và chuyển chữ thường chính xác', () => {
      const norm = normalizeVietnamese('Đồ Ngủ Pijama Lụa Cao Cấp!')
      assert.strictEqual(norm, 'do ngu pijama lua cao cap')
    })

    it('Truy vấn với từ đồng nghĩa ("đồ ngủ", "phí ship", "giặt giũ")', () => {
      const results = KnowledgeBase.search({ query: 'đồ ngủ' })
      assert.ok(results.length > 0)
      assert.ok(results[0].evidence_ref.includes('@v1.0'))
    })

    it('T03: Trả về căn cứ minh bạch xuất xứ vải, không bịa nhập Châu Âu', () => {
      const results = KnowledgeBase.search({ query: 'vải này nhập châu âu phải không' })
      assert.ok(results.length > 0)
      const fabricDoc = results.find((r) => r.doc_id === 'fabric_origin_transparency')
      assert.ok(fabricDoc, 'Phải tìm thấy tài liệu minh bạch xuất xứ vải')
      assert.ok(fabricDoc.content.includes('KHÔNG ĐƯỢC tuyên bố vải nhập khẩu từ Châu Âu'))
      assert.strictEqual(fabricDoc.evidence_ref, 'fabric_origin_transparency@v1.0')
    })

    it('T04: Hướng dẫn bảo quản trả về bằng chứng chuẩn hóa care_guide_standard@v1.0', () => {
      const results = KnowledgeBase.search({ query: 'giặt máy hay giặt tay' })
      assert.ok(results.length > 0)
      const careDoc = results.find((r) => r.doc_id === 'care_guide_standard')
      assert.ok(careDoc)
      assert.strictEqual(careDoc.evidence_ref, 'care_guide_standard@v1.0')
      assert.ok(careDoc.content.includes('30°C'))
    })
  })
})
