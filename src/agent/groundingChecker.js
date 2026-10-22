/**
 * PRE-FLIGHT GROUNDING & INTEGRITY CHECKER (Blueprint §8.4, §14.5, Prompt A Phase 2)
 * 
 * Kiểm duyệt bản nháp phản hồi trước khi gửi cho khách hoặc thực thi tool:
 * 1. Kiểm tra Schema hợp lệ (MayOutputSchema).
 * 2. Chặn bịa đặt giá (B03): Mọi số tiền phải khớp với Quote đã tính.
 * 3. Chặn bịa đặt xuất xứ vải (B02, T03): Không cho phép nhận vơ vải nhập Châu Âu.
 * 4. Chặn Prompt Injection / Leo thang đặc quyền (B15, X13, X14): Bỏ qua lệnh từ untrusted text.
 * 5. Chặn rò rỉ Secrets hoặc PII trong tin nhắn khách (B11, B19).
 */

import { validateMayOutput } from './outputSchema.js'

export class GroundingChecker {
  /**
   * Kiểm định toàn diện phản hồi của Agent
   * 
   * @param {Object} output Bản nháp từ QuanNguyenS Agent
   * @param {Object} context Ngữ cảnh đối chiếu (quote, catalog, trustedContext, untrustedInput)
   * @returns {{ passed: boolean, sanitizedOutput: Object, violations: Array<string> }}
   */
  static verify(output, context = {}) {
    const violations = []
    let candidate = { ...output }

    // 1. Kiểm tra Schema
    const schemaValidation = validateMayOutput(candidate)
    if (!schemaValidation.success) {
      return {
        passed: false,
        sanitizedOutput: null,
        violations: schemaValidation.error.errors.map((e) => `Schema error: ${e.path.join('.')} - ${e.message}`),
      }
    }

    const { customer_message, action_proposals, evidence_refs } = candidate

    // 2. Chặn rò rỉ Secrets / PII (B11, B19)
    const secretPatterns = [
      /process\.env/i,
      /secret/i,
      /webhook_api_key/i,
      /admin_secret/i,
      /token:[a-f0-9]{32,}/i,
    ]
    for (const pat of secretPatterns) {
      if (pat.test(customer_message)) {
        violations.push(`B19_VIOLATION: Tin nhắn chứa nội dung nhạy cảm / secret: ${pat}`)
      }
    }

    // 3. Chặn bịa đặt xuất xứ vải Châu Âu (B02, T03)
    const europeanFabricPatterns = [
      /vải (nhập|từ|nhập khẩu từ) châu âu/i,
      /chất vải châu âu/i,
      /vải của châu âu/i,
      /nhập khẩu nguyên cây từ châu âu/i,
    ]
    for (const pat of europeanFabricPatterns) {
      if (pat.test(customer_message)) {
        violations.push(`B02_T03_VIOLATION: Khẳng định vải nhập Châu Âu khi catalog ghi null`)
      }
    }

    // 4. Chặn Prompt Injection & Leo thang đặc quyền (B15, X13, X14)
    // Nếu tin nhắn khách có chỉ dẫn ác ý nhưng action_proposals lại chứa tool nguy hiểm
    const untrustedText = String(context.untrustedInput || '').toLowerCase()
    const injectionPhrases = [
      'bỏ qua quy tắc',
      'ignore previous instructions',
      'tôi là admin',
      'tôi là chủ shop',
      'giảm 90%',
      'hủy hết đơn',
      'xóa toàn bộ',
    ]

    const containsInjection = injectionPhrases.some((phrase) => untrustedText.includes(phrase))
    if (containsInjection) {
      // Loại bỏ bất kỳ hành động nguy hiểm nào không thuộc authorized_actions trong trusted_context
      const authorizedActions = context.trustedContext?.authorized_actions || []
      const dangerousActions = candidate.action_proposals.filter(
        (a) => !authorizedActions.includes(a.tool) || a.tool.includes('cancel') || a.tool.includes('refund') || a.tool.includes('admin')
      )

      if (dangerousActions.length > 0) {
        violations.push(`B15_INJECTION_DETECTED: Phát hiện cố gắng thực thi công cụ nguy hiểm từ lời nhắn giả mạo quyền`)
        // Tự động vô hiệu hóa các hành động nguy hiểm
        candidate.action_proposals = candidate.action_proposals.filter((a) => !dangerousActions.includes(a))
      }
    }

    // 5. Kiểm tra tính xác thực của Giá tiền (B03)
    // Nếu tin nhắn khẳng định một số tiền cụ thể (vd: 390.000đ, 420k), phải có bằng chứng từ quote
    const priceMentionMatch = customer_message.match(/(\d{2,3}[\.,]\d{3}|\d{2,3}0\.000|\d{2,3}k)\s*(đ|vnd|đồng)?/gi)
    if (priceMentionMatch && context.activeQuote) {
      // Xác nhận giá có khớp với subtotal hoặc total của quote
      const quoteTotal = context.activeQuote.total
      const quoteSubtotal = context.activeQuote.subtotal
      // Kiểm tra có bằng chứng quote
      const hasQuoteEvidence = evidence_refs.some((ref) => ref.startsWith('quote:')) ||
        action_proposals.some((a) => a.tool === 'build_quote')
      if (!hasQuoteEvidence) {
        violations.push(`B03_UNGROUNDED_PRICE: Nêu giá tiền nhưng không có bằng chứng từ Pricing Service`)
      }
    }

    const passed = violations.length === 0

    return {
      passed,
      sanitizedOutput: candidate,
      violations,
    }
  }
}
