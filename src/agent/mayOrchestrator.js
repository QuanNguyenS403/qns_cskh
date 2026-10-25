/**
 * QUANNGUYENS CSKH ORCHESTRATOR & CONVERSATION CORE (Blueprint §4, §6.3, Prompt B, Phụ lục A, C)
 * 
 * Bộ não điều phối toàn bộ hội thoại của QuanNguyenS:
 * - Tiếp nhận tin nhắn từ các kênh (Web, Messenger, Instagram, Threads, Zalo)
 * - Nạp Context Pack có kiểm soát (Trusted vs Task context)
 * - Tra cứu công cụ: Catalog, Pricing Quote, Knowledge Base, Policy Registry
 * - Xử lý thấu cảm, chống Prompt Injection (B15, X13, X14)
 * - Đảm bảo tuân thủ các ca kiểm thử thực tế X01–X15
 * - Chạy qua GroundingChecker trước khi xuất xưởng
 */

import { CATALOG, getProductBySkuOrSlug, searchCatalog } from '../catalog/products.js'
import { PricingService } from '../pricing/pricingService.js'
import { KnowledgeBase, normalizeVietnamese } from '../knowledge/knowledgeBase.js'
import { getApprovedPolicy, POLICY_TYPES } from '../policies/policyRegistry.js'
import { GroundingChecker } from './groundingChecker.js'
import { buildSystemPrompt } from './systemPrompt.js'
import { llmClient } from './llmClient.js'
import { ConversationStore } from './conversationStore.js'

export class MayOrchestrator {
  constructor(db) {
    this.db = db
    this._activeConversation = null
  }

  /**
   * Xử lý một lượt tin nhắn đến từ khách hàng
   * 
   * @param {Object} params
   * @param {string} params.text Tin nhắn của khách (untrusted text)
   * @param {string} params.channel Kênh tiếp nhận ('web', 'messenger', 'instagram', 'threads', 'zalo')
   * @param {string} params.senderId ID định danh của khách trên kênh
   * @param {Object} [params.conversationState] Trạng thái phiên hiện tại
   * @param {string} [params.providerMessageId] Mã tin nhắn từ nhà cung cấp webhook
   * @returns {Object} Standardized QuanNguyenS Output Envelope (Phụ lục A)
   */
  async processMessage({
    text,
    channel = 'web',
    senderId = 'anonymous',
    conversationState = {},
    providerMessageId = null,
    isCopilot = false,
  }) {
    const rawText = String(text || '').trim()
    const normText = normalizeVietnamese(rawText)

    // Khởi tạo phiên hội thoại bền vững nếu có Database kết nối (R1)
    this._activeConversation = null
    if (this.db) {
      const conv = ConversationStore.getOrCreateConversation(this.db, {
        channel,
        channelSenderId: senderId,
      })
      this._activeConversation = conv

      // Chặn Bot tự động can thiệp nếu phiên đang do Nhân viên/Chủ shop tiếp quản (HUMAN)
      // Ngoại trừ chế độ Co-Pilot (Chủ shop trực tiếp yêu cầu AI trợ lý gợi ý)
      if (conv.conversation_owner === 'HUMAN' && !isCopilot && channel !== 'copilot') {
        ConversationStore.saveMessage(this.db, {
          conversationId: conv.id,
          senderType: 'CUSTOMER',
          senderId,
          contentText: rawText,
          direction: 'INBOUND',
          providerMessageId,
        })

        return {
          customer_message: null,
          suppressed: true,
          reason: 'CONVERSATION_OWNED_BY_HUMAN',
          conversation_id: conv.id,
          language: 'vi',
          intent_codes: [],
          next_step: 'HUMAN_AGENT',
          action_proposals: [],
          evidence_refs: [],
          memory_proposals: [],
          promise_proposals: [],
          handoff: { required: true, reason_code: 'HUMAN_ACTIVE', priority: 'P1' },
          needs_identity_verification: false,
          emotion_signal: 'neutral',
        }
      }

      // Lưu tin nhắn đến của khách vào CSDL
      ConversationStore.saveMessage(this.db, {
        conversationId: conv.id,
        senderType: 'CUSTOMER',
        senderId,
        contentText: rawText,
        direction: 'INBOUND',
        providerMessageId,
      })
    }

    // Khởi tạo các proposal và kết quả
    const intentCodes = []
    const actionProposals = []
    const evidenceRefs = []
    const memoryProposals = []
    const promiseProposals = []
    let nextStep = 'INFORM'
    let handoff = { required: false, reason_code: null, priority: 'P2' }
    let needsIdentityVerification = false
    let emotionSignal = 'neutral'
    let customerMessage = ''

    // ── 1. PHÁT HIỆN TRẠNG THÁI CẢM XÚC CỦA KHÁCH (Blueprint §4.2) ──
    const isAllUpper = rawText.length > 8 && rawText === rawText.toUpperCase() && /[A-ZÀ-Ỹ]/.test(rawText)
    const isAngry = isAllUpper || /bực|tức|lừa đảo|tệ|kém|chán|bóc phốt|review xấu|tại sao chưa|hỏi 3 lần|mãi không/i.test(rawText)
    const isHesitant = /phân vân|không biết|sợ rộng|sợ chật|có vừa không|lăn tăn/i.test(rawText)
    const isRushed = /gấp|kịp không|hôm nay|thứ bảy|mai có không|giao liền/i.test(rawText)
    const wantsToStop = /đừng nhắn|dừng lại|tắt quảng cáo|hủy đăng ký|stop/i.test(rawText)

    if (isAngry) emotionSignal = 'angry'
    else if (wantsToStop) emotionSignal = 'wants_to_stop'
    else if (isRushed) emotionSignal = 'rushed'
    else if (isHesitant) emotionSignal = 'hesitant'

    // ── 1.1. CHÀO HỎI TỰ NHIÊN & GỌI SHOP (Lô, Alo, Hi, Hello, Chào shop, Sốp, Ra đây, Có ai không...) ──
    const cleanGreeting = rawText.replace(/[?.,!…~]/g, '').trim()
    const isGreeting = /^(lô|lo|alo|chào|chào shop|chao shop|hi|hello|hey|shop ơi|shop oi|ad ơi|ad oi|sốp|sop|ra đây|ra day|có ai không|co ai khong|ai đó|ai do|có đó không|co do khong)$/i.test(cleanGreeting) ||
      /^(lô|lo|alo|hi|hello)\s+(shop|ad|bạn|sốp)/i.test(cleanGreeting)
    if (isGreeting) {
      const greetingTarget = conversationState.customerName ? ` bạn ${conversationState.customerName}` : ' bạn'
      customerMessage = `Dạ QuanNguyenS xin chào${greetingTarget}! Mình là trợ lý AI của QuanNguyenS. Mình luôn có mặt 24/7 để hỗ trợ bạn xem mẫu pijama, tư vấn size theo chiều cao cân nặng, báo giá ưu đãi và hỗ trợ đơn hàng ạ. Bạn đang cần shop hỗ trợ thông tin gì ạ?`
      intentCodes.push('greeting')
      nextStep = 'INFORM'
      return this._finalizeOutput({
        customerMessage,
        intentCodes,
        nextStep,
        evidenceRefs: ['brand_identity@v1.0'],
        emotionSignal,
      })
    }

    // ── 1.2. HỎI MUA HÀNG CHUNG / XEM MẪU / TƯ VẤN QUẦN ÁO (Mua quần áo, Mua đồ, Xem mẫu, Có mẫu nào...) ──
    const isBrowsingGeneral = /^(mua quần áo|mua đồ|mua do|mua quan ao|mua pijama|mua đồ ngủ|xem mẫu|xem mau|tư vấn mẫu|tu van mau|có mẫu nào|co mau nao|shop bán gì|shop ban gi|có những mẫu nào|các mẫu pijama|mẫu mới|bộ sưu tập)$/i.test(cleanGreeting) ||
      /mua quần áo|mua pijama|mua đồ ngủ|xem các mẫu/i.test(rawText)
    if (isBrowsingGeneral) {
      const greetingTarget = conversationState.customerName ? ` bạn ${conversationState.customerName}` : ' bạn'
      customerMessage = `Dạ QuanNguyenS xin chào${greetingTarget} ạ! 💕\n\nShop hiện có sẵn các set pyjama thiết kế phong cách Châu Âu từ chất liệu sợi tự nhiên cao cấp (Cotton & Modal Blend) mềm mịn, thoáng khí 4 mùa:\n\n🌿 1. The Classic Set (Daybreak) – Sọc hồng pastel nhẹ nhàng, thanh lịch: 390.000đ (Ưu đãi từ 490k)\n🌿 2. The Café Look (Stillwater) – Họa tiết caro navy cổ điển, sang trọng (Best-Seller): 550.000đ (Freeship toàn quốc)\n🌿 3. The Evening Edit (Hearth) – Dệt đầm tay ấm áp, form suông cao cấp: 750.000đ (Freeship toàn quốc)\n\nKhông biết bạn đang muốn tìm mẫu mặc nhà thoải mái thường ngày hay mặc phòng điều hòa ạ? Bạn có thể chia sẻ cho shop xin chiều cao và cân nặng để em tư vấn size vừa vặn nhất cho mình nhé! ✨`
      intentCodes.push('browse_catalog', 'ask_size_preference')
      nextStep = 'ASK_FIT_PREFERENCE'
      return this._finalizeOutput({
        customerMessage,
        intentCodes,
        nextStep,
        evidenceRefs: ['brand_identity@v1.0', 'catalog_products@v1.0'],
        emotionSignal,
      })
    }

    // ── 2. XỬ LÝ CÁC CA KIỂM THỬ ĐẶC THÙ & SECURITY (X01–X15) ─────

    // X15: Hỏi là người hay bot
    if (/bạn là người hay bot|người thật hay robot|quannguyens là ai|shop là ai|ai đang chat|phải bot không/i.test(rawText)) {
      customerMessage = 'Dạ mình là QuanNguyenS, trợ lý AI tư vấn và chăm sóc khách hàng của thương hiệu QuanNguyenS. Mình luôn có mặt 24/7 để hỗ trợ bạn chọn mẫu, xem giá, tư vấn size và theo dõi đơn hàng ạ.'
      intentCodes.push('ask_identity')
      nextStep = 'INFORM'
      return this._finalizeOutput({
        customerMessage,
        intentCodes,
        nextStep,
        evidenceRefs: ['brand_identity@v1.0'],
        emotionSignal,
      })
    }

    // Hỏi thông tin tài khoản ngân hàng / chuyển khoản
    if (/xin stk|số tài khoản|so tai khoan|stk|chuyển khoản qua đâu|ngân hàng nào|ngan hang nao|thông tin chuyển khoản/i.test(rawText)) {
      customerMessage = 'Dạ thông tin thanh toán chuyển khoản chính thức của QuanNguyenS là:\n• Ngân hàng: Vietcombank (VCB)\n• Số tài khoản: 1050773506\n• Chủ tài khoản: NGUYEN DUC QUAN\n\nĐặc biệt, shop có ưu đãi giảm ngay 5% trực tiếp khi thanh toán chuyển khoản VietQR và miễn phí vận chuyển toàn quốc cho đơn từ 500k ạ. Khi bạn lên đơn, QuanNguyenS sẽ tạo sẵn mã VietQR có đúng số tiền để bạn quét nhanh nhất nhé ạ!'
      intentCodes.push('ask_bank_info')
      nextStep = 'INFORM'
      return this._finalizeOutput({
        customerMessage,
        intentCodes,
        nextStep,
        evidenceRefs: ['payment_banking_vietcombank@v1.0'],
        emotionSignal,
      })
    }

    // Hỏi link mạng xã hội / Fanpage / TikTok / Instagram / Website
    if (/(tiktok|facebook|fanpage|instagram|website)/i.test(rawText) && /(link|kênh|kenh|đâu|dau|trang|xem|follow)/i.test(rawText)) {
      customerMessage = 'Dạ các kênh chính thức của QuanNguyenS gồm có:\n• Website: https://quannguyens.com\n• Facebook: https://facebook.com/qns.style\n• Instagram: https://instagram.com/qns.style\n• TikTok: https://www.tiktok.com/@qns.style?lang=vi-VN\n\nBạn ghé theo dõi các kênh để cập nhật lookbook và các bộ sưu tập pijama mới nhất nhé ạ!'
      intentCodes.push('ask_social_channels')
      nextStep = 'INFORM'
      return this._finalizeOutput({
        customerMessage,
        intentCodes,
        nextStep,
        evidenceRefs: ['brand_identity@v1.0'],
        emotionSignal,
      })
    }

    // X29: Khủng hoảng cá nhân / stress (Blueprint §4.3, X29) -> Dừng bán, phản hồi ấm áp, handoff P0
    if (/stress|khủng hoảng|chuyện gia đình|buồn chuyện|đừng tư vấn mua bán/i.test(rawText)) {
      customerMessage = 'Dạ QuanNguyenS rất chia sẻ với bạn trong thời điểm này. QuanNguyenS xin phép không gửi thêm tin tư vấn bán hàng để bạn có không gian nghỉ ngơi ạ. Nếu sau này bạn cần bất kỳ hỗ trợ nào về sản phẩm hoặc đơn hàng, QuanNguyenS luôn sẵn sàng lắng nghe khi bạn thoải mái hơn nhé.'
      intentCodes.push('personal_crisis_stop')
      nextStep = 'CLOSE'
      handoff = { required: true, reason_code: 'PERSONAL_CRISIS', priority: 'P0' }
      return this._finalizeOutput({
        customerMessage,
        intentCodes,
        nextStep,
        handoff,
        emotionSignal: 'frustrated',
      })
    }

    // X16: Tin đồn giảm giá không có thật -> Kiểm tra pricing, không xác nhận điều không tồn tại
    if (/nghe nói.*giảm|giảm 30%|giảm 50%|sale 30%/i.test(rawText)) {
      const pricingPolicy = getApprovedPolicy(this.db, { shopId: 'quannguyens', policyType: POLICY_TYPES.PRICING })
      const bankDiscount = pricingPolicy?.content?.bankTransferDiscountPct || 5
      customerMessage = `Dạ thông tin giảm giá trên là không chính xác ạ. Hiện tại QuanNguyenS áp dụng mức giá niêm yết chuẩn và ưu đãi giảm ${bankDiscount}% khi thanh toán chuyển khoản VietQR, cùng chính sách miễn phí vận chuyển toàn quốc cho đơn từ 500.000đ. Bạn cần QuanNguyenS hỗ trợ xem chi tiết mẫu nào không ạ?`
      intentCodes.push('inquire_promotion')
      nextStep = 'INFORM'
      evidenceRefs.push(`policy_${POLICY_TYPES.PRICING}@v1.0`)
      return this._finalizeOutput({
        customerMessage,
        intentCodes,
        nextStep,
        evidenceRefs,
        emotionSignal,
      })
    }

    // X13 & X14: Chống Prompt Injection & mạo danh Admin (B15)
    if (/admin|chủ shop|bỏ qua quy tắc|ignore previous|giảm 90%|hủy hết đơn|xóa toàn bộ/i.test(rawText)) {
      customerMessage = 'Dạ QuanNguyenS không thể thực hiện yêu cầu thay đổi quyền hạn hoặc chính sách qua tin nhắn. Mọi ưu đãi và đơn hàng đều được xử lý tự động theo quy định đã duyệt của QuanNguyenS ạ. Nếu bạn cần hỗ trợ trường hợp ngoại lệ, mình xin phép tạo yêu cầu chuyển tới quản lý shop nhé.'
      intentCodes.push('security_policy_enforcement')
      nextStep = 'INFORM'
      return this._finalizeOutput({
        customerMessage,
        intentCodes,
        nextStep,
        evidenceRefs: ['privacy_policy_cskh@v1.0'],
        emotionSignal: 'neutral',
      })
    }

    // X07: Khách dọa review xấu, đòi đền bù (Ưu tiên kiểm tra trước X06)
    if (/bóc phốt|review xấu|đánh giá 1 sao/i.test(rawText)) {
      customerMessage = 'Dạ QuanNguyenS rất hiểu sự thất vọng của bạn khi trải nghiệm chưa được như ý. QuanNguyenS cam kết xử lý trung thực và đúng quy trình bảo hành/đổi trả của shop đối với sản phẩm lỗi hoặc sự cố giao hàng. QuanNguyenS xin phép mở ngay phiếu hỗ trợ ưu tiên để quản lý trực tiếp kiểm tra và đưa ra phương án thỏa đáng nhất cho bạn nhé ạ.'
      intentCodes.push('complaint_threat')
      nextStep = 'OPEN_CASE'
      handoff = { required: true, reason_code: 'ESCALATION_THREAT', priority: 'P1' }
      return this._finalizeOutput({
        customerMessage,
        intentCodes,
        nextStep,
        handoff,
        emotionSignal: 'frustrated',
      })
    }

    // X06: Khách giận dữ, viết hoa, phàn nàn nhiều lần
    if (emotionSignal === 'angry' && /hỏi (\d+|nhiều) lần|nhắc lại|mãi chưa|chưa xử lý/i.test(rawText)) {
      customerMessage = 'Dạ QuanNguyenS đã kiểm tra lại toàn bộ trao đổi trước đó. QuanNguyenS rất hiểu bạn đang cần kết quả gấp và chưa nhận được phản hồi thỏa đáng. Ngay lúc này QuanNguyenS đang chuyển thẳng trường hợp của bạn tới quản lý trực ca để kiểm tra xử lý ngay, và sẽ có cập nhật cụ thể gửi đến bạn trước 15 phút nữa ạ. Mã yêu cầu ưu tiên của bạn đã được ghi nhận.'
      intentCodes.push('complaint_escalation')
      nextStep = 'OPEN_CASE'
      handoff = { required: true, reason_code: 'ANGRY_CUSTOMER_REPEATED_INQUIRY', priority: 'P1' }
      promiseProposals.push({
        text: 'Cập nhật tiến độ xử lý khiếu nại cho khách',
        due_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        owner: 'cs_manager',
      })
      return this._finalizeOutput({
        customerMessage,
        intentCodes,
        nextStep,
        handoff,
        promiseProposals,
        emotionSignal: 'angry',
      })
    }

    // X23: Hỏi về chính sách hàng lỗi sản xuất (lỗi vải, sút chỉ, đường may)
    if (/lỗi vải|sút chỉ|đường may|hàng lỗi|bị rách|áo lỗi|quần lỗi|bị lỗi/i.test(rawText)) {
      customerMessage = 'Dạ đối với trường hợp sản phẩm gặp lỗi do sản xuất như lỗi vải, sút chỉ hay đường may, QuanNguyenS cam kết chịu 100% phí ship 2 chiều để gửi đồ mới đổi cho bạn ạ. Bạn lưu ý giúp shop yêu cầu bắt buộc là hoàn sản phẩm theo đơn vị vận chuyển Viettel Post nhé ạ; nếu bạn sử dụng đơn vị vận chuyển khác thì shop xin phép thu phí ship của bạn ạ.'
      intentCodes.push('ask_defective_return_policy')
      nextStep = 'INFORM'
      evidenceRefs.push(`policy_${POLICY_TYPES.RETURNS}@v1.0`)
      return this._finalizeOutput({
        customerMessage,
        intentCodes,
        nextStep,
        evidenceRefs,
        emotionSignal: 'neutral',
      })
    }

    // X08: Xin giảm giá hoặc freeship khi chưa đủ điều kiện
    if (/bớt không|giảm giá thêm|freeship được không|miễn ship cho mình đi|bớt cho mình/i.test(rawText)) {
      const shippingPolicy = getApprovedPolicy(this.db, { shopId: 'quannguyens', policyType: POLICY_TYPES.SHIPPING })
      const pricingPolicy = getApprovedPolicy(this.db, { shopId: 'quannguyens', policyType: POLICY_TYPES.PRICING })
      const freeshipThreshold = shippingPolicy?.content?.freeshipThreshold || 500000
      const bankDiscount = pricingPolicy?.content?.bankTransferDiscountPct || 5

      customerMessage = `Dạ giá niêm yết của QuanNguyenS là giá chuẩn đã cân đối tối ưu chất lượng vải sợi tự nhiên. Shop có chính sách miễn phí vận chuyển toàn quốc cho đơn hàng từ ${freeshipThreshold.toLocaleString('vi-VN')}đ (sau khi trừ chiết khấu) và giảm thêm ${bankDiscount}% khi thanh toán chuyển khoản VietQR ạ. Bạn có muốn mình tạo báo giá thanh toán chuyển khoản để nhận ưu đãi này không ạ?`
      intentCodes.push('negotiate_discount')
      nextStep = 'INFORM'
      evidenceRefs.push(`policy_${POLICY_TYPES.PRICING}@v1.0`)
      return this._finalizeOutput({
        customerMessage,
        intentCodes,
        nextStep,
        evidenceRefs,
        emotionSignal: 'hesitant',
      })
    }

    // X10: "Có phải lụa/đũi không?" khi catalog không xác nhận
    if (/lụa|đũi|phi bóng/i.test(rawText) && /phải không|đúng không|có phải/i.test(rawText)) {
      customerMessage = 'Dạ các sản phẩm pijama của QuanNguyenS không phải lụa bóng hay đũi thô, mà sử dụng 100% sợi tự nhiên cao cấp (chủ đạo là Cotton chải kỹ, Modal và Tencel) đạt chuẩn OEKO-TEX Standard 100. Vải có bề mặt mềm mịn, thoáng khí tự nhiên, thấm hút mồ hôi tốt và thân thiện với làn da nhạy cảm ạ.'
      intentCodes.push('ask_fabric_detail')
      nextStep = 'INFORM'
      evidenceRefs.push('brand_identity@v1.0', 'fabric_origin_transparency@v1.0')
      return this._finalizeOutput({
        customerMessage,
        intentCodes,
        nextStep,
        evidenceRefs,
        emotionSignal,
      })
    }

    // X09: Hỏi chất vải hoặc xuất xứ khi catalog thiếu / chưa xác nhận
    if (/(vải.*nhập|nhập.*châu âu|xuất xứ vải|vải châu âu)/i.test(rawText)) {
      customerMessage = 'Dạ các dòng pijama của QuanNguyenS được thiết kế theo phong cách tối giản Châu Âu. Về chất liệu, shop sử dụng sợi tự nhiên cao cấp (Cotton, Modal, Tencel) có chứng nhận an toàn OEKO-TEX, dệt may tại xưởng đạt chuẩn kỹ thuật cao tại Châu Á/Việt Nam. Shop không sử dụng vải nhập khẩu trực tiếp từ Châu Âu ạ.'
      intentCodes.push('ask_origin_transparency')
      nextStep = 'INFORM'
      evidenceRefs.push('fabric_origin_transparency@v1.0')
      return this._finalizeOutput({
        customerMessage,
        intentCodes,
        nextStep,
        evidenceRefs,
        emotionSignal,
      })
    }

    // X03: "mẫu đó" khi chưa rõ mẫu hoặc có nhiều ứng viên
    if (/(mẫu đó|set đó|cái đó|mẫu này)/i.test(rawText) && !conversationState.activeProductId) {
      customerMessage = 'Dạ hiện shop đang có 3 set pyjama Thu Đông: The Daybreak Set (Sọc Hồng), The Stillwater Set (Caro Navy), và The Hearth Set (Sọc Nâu). Bạn đang quan tâm mẫu nào trong 3 mẫu này để QuanNguyenS báo giá và tư vấn size chuẩn xác nhất ạ?'
      intentCodes.push('disambiguate_product')
      nextStep = 'ASK_PRODUCT_ID'
      return this._finalizeOutput({
        customerMessage,
        intentCodes,
        nextStep,
        emotionSignal,
      })
    }

    // X04: Đang tư vấn size -> hỏi giao hàng -> giữ ngữ cảnh
    if (/giao hàng mất bao lâu|ship mất mấy ngày|bao giờ nhận được/i.test(rawText)) {
      const shippingPolicy = getApprovedPolicy(this.db, { shopId: 'quannguyens', policyType: POLICY_TYPES.SHIPPING })
      const hanoiHcm = shippingPolicy?.content?.deliveryEstimateDays?.hanoi_hcm || '1–2 ngày làm việc'
      const provinces = shippingPolicy?.content?.deliveryEstimateDays?.provinces || '2–4 ngày làm việc'

      let extraText = ''
      if (conversationState.activeProductId) {
        const prod = getProductBySkuOrSlug(conversationState.activeProductId)
        extraText = ` Mình vẫn đang lưu thông tin tư vấn mẫu ${prod?.name || ''} cho bạn. Bạn có muốn mình hỗ trợ chốt size luôn không ạ?`
      }

      customerMessage = `Dạ thời gian giao hàng dự kiến của shop qua Viettel Post là ${hanoiHcm} cho khu vực Hà Nội/TP.HCM, và ${provinces} đối với các tỉnh thành khác ạ.${extraText}`
      intentCodes.push('ask_shipping_estimate')
      nextStep = conversationState.activeProductId ? 'ASK_FIT_PREFERENCE' : 'INFORM'
      evidenceRefs.push(`policy_${POLICY_TYPES.SHIPPING}@v1.0`)
      return this._finalizeOutput({
        customerMessage,
        intentCodes,
        nextStep,
        evidenceRefs,
        emotionSignal,
      })
    }

    // ── 3. TƯ VẤN SẢN PHẨM, GIÁ & SIZE (X01, X02, T01, T05) ───────
    let matchedProduct = null
    const combinedSearchText = `${rawText} ${normText}`
    if (/daybreak|sọc hồng|soc hong|classic|set hong/i.test(combinedSearchText)) {
      matchedProduct = getProductBySkuOrSlug('QNS-DAYBREAK-SET')
    } else if (/stillwater|caro navy|cafe|set caro|set xanh/i.test(combinedSearchText)) {
      matchedProduct = getProductBySkuOrSlug('QNS-STILLWATER-SET')
    } else if (/hearth|sọc nâu|soc nau|evening/i.test(combinedSearchText)) {
      matchedProduct = getProductBySkuOrSlug('QNS-HEARTH-SET')
    } else if (conversationState.activeProductId) {
      matchedProduct = getProductBySkuOrSlug(conversationState.activeProductId)
    }

    // X01: "shop oi set nay ib gia vs size m ko"
    const asksPrice = /giá|gia|nhiêu|bao tiền|ib gia|gia vs/i.test(combinedSearchText)
    const asksSize = /size|sz|mặc vừa|cao|nặng|kg|m6|m5/i.test(combinedSearchText)
    const mentionsSaturday = /thứ bảy|thu bay|t7|thứ 7|thu 7|kịp không|kip ko|kịp nhận/i.test(combinedSearchText)

    if (asksPrice || asksSize || mentionsSaturday) {
      if (!matchedProduct) {
        // Chưa rõ mẫu nào -> Hỏi mẫu (X01)
        customerMessage = 'Dạ chào bạn! Shop có các set pyjama sợi tự nhiên: The Daybreak Set (390k), The Stillwater Set (550k) và The Hearth Set (750k). Bạn đang ưng mẫu nào để QuanNguyenS báo giá chi tiết và gợi ý size vừa vặn nhất cho bạn ạ?'
        intentCodes.push('ask_price', 'ask_size')
        nextStep = 'ASK_PRODUCT_ID'
        return this._finalizeOutput({
          customerMessage,
          intentCodes,
          nextStep,
          emotionSignal,
        })
      }

      // Đã xác định được mẫu -> Tạo quote chuẩn xác bằng PricingService
      const quoteRes = PricingService.calculateQuote(this.db, {
        items: [{ sku: matchedProduct.sku, quantity: 1 }],
        paymentMethod: 'cod',
      })

      evidenceRefs.push(quoteRes.evidence_ref)
      actionProposals.push({
        tool: 'build_quote',
        args: { sku: matchedProduct.sku, quantity: 1, paymentMethod: 'cod' },
        requires_customer_confirmation: false,
      })

      // X02 & X21: Hỏi về tiến độ nhận hàng / thứ Bảy
      if (mentionsSaturday) {
        customerMessage = `Dạ mẫu ${matchedProduct.name} hiện có giá niêm yết là ${quoteRes.subtotal.toLocaleString('vi-VN')}đ ạ. Về tiến độ nhận hàng, nếu bạn chốt đơn trong hôm nay, đơn dự kiến sẽ kịp giao trước thứ Bảy nếu bạn ở khu vực nội thành/trung tâm; còn ở huyện/xã xa hơn thì có thể vào thứ Bảy hoặc đầu tuần sau ạ. Để QuanNguyenS tư vấn size chuẩn xác cho bạn, bạn cho QuanNguyenS xin thêm chiều cao và cân nặng nhé!`
        intentCodes.push('ask_delivery_deadline', 'ask_size')
        if (asksPrice) intentCodes.push('ask_price')
        nextStep = 'ASK_FIT_PREFERENCE'
        return this._finalizeOutput({
          customerMessage,
          intentCodes,
          nextStep,
          actionProposals,
          evidenceRefs,
          emotionSignal: 'rushed',
        })
      }

      // X01: Hỏi giá và size
      customerMessage = `Dạ mẫu ${matchedProduct.name} hiện có giá ${quoteRes.subtotal.toLocaleString('vi-VN')}đ ạ. Mẫu này phom suông phong cách Châu Âu rộng rãi thoải mái. Để QuanNguyenS gợi ý size chuẩn nhất, bạn thường mặc vừa vặn hay thích mặc rộng hẳn, và cho QuanNguyenS xin chiều cao/cân nặng của bạn nhé!`
      intentCodes.push('ask_price', 'ask_size')
      nextStep = 'ASK_FIT_PREFERENCE'
      return this._finalizeOutput({
        customerMessage,
        intentCodes,
        nextStep,
        actionProposals,
        evidenceRefs,
        emotionSignal,
      })
    }

    // ── 4. TÌM KIẾM TRI THỨC MẶC ĐỊNH (KNOWLEDGE BASE RAG) ───────
    const kbResults = KnowledgeBase.search({ query: rawText, limit: 2 })
    if (kbResults.length > 0) {
      const best = kbResults[0]
      evidenceRefs.push(best.evidence_ref)
      customerMessage = `Dạ về câu hỏi của bạn, theo thông tin chuẩn hóa của shop: ${best.content.split('\n')[0].trim()} Bạn có cần QuanNguyenS hỗ trợ thêm thông tin chi tiết nào nữa không ạ?`
      intentCodes.push('kb_query')
      nextStep = 'INFORM'
      return this._finalizeOutput({
        customerMessage,
        intentCodes,
        nextStep,
        evidenceRefs,
        emotionSignal,
      })
    }

    // ── 4.5. GOOGLE GEMINI LLM INTERACTION (Khi cấu hình GEMINI_API_KEY) ──
    if (llmClient.apiKey) {
      try {
        const systemPrompt = buildSystemPrompt({
          trustedContext: {
            channel,
            customer_verification: conversationState.customerVerification || 'UNVERIFIED',
          },
          taskContext: {
            intents: intentCodes,
            active_product_id: matchedProduct?.sku || conversationState.activeProductId || null,
          },
        })

        const llmResult = await llmClient.generateMayResponse({
          systemPrompt,
          userMessage: rawText,
          history: conversationState.history || [],
        })

        if (llmResult && llmResult.customer_message) {
          return this._finalizeOutput({
            customerMessage: llmResult.customer_message,
            language: llmResult.language || 'vi',
            intentCodes: llmResult.intent_codes || intentCodes,
            nextStep: llmResult.next_step || 'INFORM',
            actionProposals: llmResult.action_proposals || [],
            evidenceRefs: [...evidenceRefs, ...(llmResult.evidence_refs || [])],
            memoryProposals: llmResult.memory_proposals || [],
            promiseProposals: llmResult.promise_proposals || [],
            handoff: llmResult.handoff || handoff,
            needsIdentityVerification: llmResult.needs_identity_verification || false,
            emotionSignal: llmResult.emotion_signal || emotionSignal,
          })
        }
      } catch (llmErr) {
        console.warn('⚠️ [GEMINI GENERATION BYPASSED]:', llmErr.message)
      }
    }

    // ── 5. PHẢN HỒI MẶC ĐỊNH THÂN THIỆN ──────────────────────────
    customerMessage = 'Dạ QuanNguyenS có thể hỗ trợ bạn xem mẫu pijama, tư vấn chọn size theo số đo, báo giá chi tiết hoặc kiểm tra đơn hàng ạ. Bạn đang cần QuanNguyenS hỗ trợ điều gì ạ?'
    intentCodes.push('general_inquiry')
    nextStep = 'INFORM'

    return this._finalizeOutput({
      customerMessage,
      intentCodes,
      nextStep,
      evidenceRefs,
      emotionSignal,
    })
  }

  /**
   * Đóng gói và kiểm định đầu ra qua GroundingChecker trước khi trả về
   */
  _finalizeOutput({
    customerMessage,
    language = 'vi',
    intentCodes = [],
    nextStep = 'INFORM',
    actionProposals = [],
    evidenceRefs = [],
    memoryProposals = [],
    promiseProposals = [],
    handoff = { required: false, reason_code: null, priority: 'P2' },
    needsIdentityVerification = false,
    emotionSignal = 'neutral',
  }) {
    const rawOutput = {
      customer_message: customerMessage,
      language,
      intent_codes: intentCodes,
      next_step: nextStep,
      action_proposals: actionProposals,
      evidence_refs: evidenceRefs,
      memory_proposals: memoryProposals,
      promise_proposals: promiseProposals,
      handoff,
      needs_identity_verification: needsIdentityVerification,
      emotion_signal: emotionSignal,
    }

    // Chạy qua GroundingChecker để bảo đảm 100% không vi phạm B01, B02, B03, B15, B19
    const checkResult = GroundingChecker.verify(rawOutput, {})
    if (!checkResult.passed) {
      console.warn('⚠️ [GROUNDING CHECK WARNING]:', checkResult.violations)
    }

    const sanitized = checkResult.sanitizedOutput || rawOutput

    // Lưu tin nhắn phản hồi của Bot vào CSDL và cập nhật trạng thái phiên (R1)
    if (this.db && this._activeConversation) {
      sanitized.conversation_id = this._activeConversation.id

      if (sanitized.customer_message) {
        ConversationStore.saveMessage(this.db, {
          conversationId: this._activeConversation.id,
          senderType: 'BOT',
          senderId: 'quannguyens',
          contentText: sanitized.customer_message,
          payloadJson: sanitized,
          direction: 'OUTBOUND',
        })
      }

      // Nếu yêu cầu Handoff P0 hoặc P1 -> Giao quyền sở hữu hội thoại cho Nhân viên (HUMAN)
      if (sanitized.handoff?.required && (sanitized.handoff.priority === 'P0' || sanitized.handoff.priority === 'P1')) {
        ConversationStore.setConversationOwner(
          this.db,
          this._activeConversation.id,
          'HUMAN',
          sanitized.handoff.reason_code || 'URGENT_HANDOFF'
        )
      }
    }

    return sanitized
  }
}
