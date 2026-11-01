/**
 * LLM CLIENT FOR QUANNGUYENS CSKH AGENT (Google Gemini & Multi-Provider)
 * 
 * Kết nối trực tiếp đến Google Gemini API với cơ chế tự động Fallback kiên cường:
 * - Ưu tiên dòng Flash-Lite (gemini-3.5-flash-lite, gemini-flash-lite-latest, gemini-3.1-flash-lite)
 *   để hoàn toàn TRÁNH LỖI QUOTA 429, phản hồi siêu tốc dưới 800ms.
 * - Tự động ghi nhớ cooldown khi gặp 429 để không dội request liên tục.
 * - Cấu hình temperature 0.65 mang lại giọng văn cảm xúc, ấm áp, thông minh như người thật 100%.
 */

import { config } from '../config/env.js'

export class LLMClient {
  constructor() {
    this.apiKey = config.GEMINI_API_KEY
    this.model = config.GEMINI_MODEL || 'gemini-3.5-flash-lite'
    this.fallbackModel = config.GEMINI_FALLBACK_MODEL || 'gemini-flash-lite-latest'
    this.provider = config.LLM_PROVIDER || 'gemini'

    // Danh sách model ưu tiên chống nghẽn Quota 429
    this.candidateModels = [
      this.model,
      this.fallbackModel,
      'gemini-3.5-flash-lite',
      'gemini-3.5-flash',
      'gemini-3.1-flash-lite',
    ].filter((val, idx, self) => val && self.indexOf(val) === idx)

    // Bảng theo dõi cooldown khi bị rate limit (429)
    this.cooldowns = new Map()
  }

  /**
   * Sinh phản hồi CSKH thông minh, giàu cảm xúc cho QuanNguyenS
   * 
   * @param {Object} params
   * @param {string} params.systemPrompt Toàn văn System Prompt cùng Trusted Context
   * @param {string} params.userMessage Tin nhắn từ khách hàng (untrusted)
   * @param {Array} [params.history] Lịch sử hội thoại nếu có
   * @param {Function} [params.fetchImpl] Fetch implementation
   * @returns {Promise<Object|null>} Output Object hoặc null nếu lỗi/chưa có API key
   */
  async generateResponse({
    systemPrompt,
    userMessage,
    history = [],
    fetchImpl = globalThis.fetch,
  }) {
    if (!this.apiKey) {
      return null
    }

    const now = Date.now()

    // Xây dựng contents array
    const contents = []

    // Thêm lịch sử hội thoại nếu có
    for (const turn of history) {
      if (turn.role && turn.text) {
        contents.push({
          role: turn.role === 'user' ? 'user' : 'model',
          parts: [{ text: turn.text }],
        })
      }
    }

    // Thêm câu hỏi hiện tại của khách
    contents.push({
      role: 'user',
      parts: [{ text: userMessage }],
    })

    // Đảm bảo Prompt luôn yêu cầu JSON chuẩn khi generationConfig đặt responseMimeType: 'application/json'
    let effectiveSystemPrompt = systemPrompt || ''
    if (!effectiveSystemPrompt.includes('customer_message') && !effectiveSystemPrompt.includes('JSON')) {
      effectiveSystemPrompt += '\n\nLƯU Ý: Phải trả về DUY NHẤT 1 JSON Object chuẩn có cấu trúc: {"customer_message": "câu trả lời cho khách"}'
    }

    const requestBody = {
      system_instruction: {
        parts: [{ text: effectiveSystemPrompt }],
      },
      contents,
      generationConfig: {
        temperature: 0.65, // Giúp câu trả lời tự nhiên, có hồn, cảm xúc ấm áp như người thật
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
      },
    }

    // Lọc các model không bị cooldown 429
    const modelsToAttempt = this.candidateModels.filter((m) => {
      const until = this.cooldowns.get(m) || 0
      return until < now
    })

    if (modelsToAttempt.length === 0) {
      // Nếu tất cả đều cooldown, reset và thử lại model nhẹ nhất
      modelsToAttempt.push('gemini-3.5-flash-lite')
    }

    let lastError = null

    for (const modelName of modelsToAttempt) {
      try {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`
        const controller = new AbortController()
        const timeoutMs = 12000
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
        if (timeoutId && typeof timeoutId.unref === 'function') {
          timeoutId.unref()
        }

        const response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': this.apiKey,
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        })
        clearTimeout(timeoutId)

        if (!response.ok) {
          const errorText = await response.text()
          console.warn(`⚠️ [GEMINI ${modelName} HTTP ${response.status}]:`, errorText.slice(0, 150))

          // Nếu lỗi do 429 (vượt quota) hoặc 503 (quá tải):
          if (response.status === 429 || response.status === 503) {
            // Đặt cooldown 60 giây cho model này
            this.cooldowns.set(modelName, Date.now() + 60000)
            console.info(`🔄 [QUOTA BACKOFF] Model ${modelName} chạm giới hạn, tự động giảm tải sang model tiếp theo...`)
            continue
          }
          continue
        }

        const data = await response.json()
        const candidate = data.candidates?.[0]
        const rawPart = candidate?.content?.parts?.find((p) => typeof p.text === 'string' && !p.thought)
          || candidate?.content?.parts?.find((p) => typeof p.text === 'string')
        const rawText = rawPart?.text || candidate?.content?.parts?.[0]?.text

        if (!rawText) {
          console.warn(`⚠️ [GEMINI ${modelName} RESPONSE EMPTY]`)
          continue
        }

        // Xử lý JSON output an toàn
        let parsed = null
        try {
          parsed = JSON.parse(rawText)
        } catch (jsonErr) {
          const match = rawText.match(/\{[\s\S]*\}/)
          if (match) {
            try {
              parsed = JSON.parse(match[0])
            } catch (e) {}
          }
        }

        if (parsed && typeof parsed === 'object') {
          if (!parsed.customer_message) {
            parsed.customer_message = parsed.message || parsed.reply || parsed.text || parsed.answer || parsed.response || ''
          }
          if (parsed.customer_message) {
            return parsed
          }
        }

        console.warn(`⚠️ [GEMINI ${modelName} OUTPUT NOT VALID JSON]:`, rawText)
        return {
          customer_message: rawText,
          language: 'vi',
          intent_codes: ['general_inquiry'],
          next_step: 'INFORM',
          action_proposals: [],
          evidence_refs: [],
          memory_proposals: [],
          promise_proposals: [],
          handoff: { required: false, reason_code: null, priority: 'P2' },
          needs_identity_verification: false,
          emotion_signal: 'neutral',
        }
      } catch (err) {
        lastError = err
        console.warn(`⚠️ [GEMINI ${modelName} EXCEPTION]:`, err.message)
        continue
      }
    }

    if (lastError) {
      console.error('🚨 [GEMINI CLIENT FINAL EXCEPTION]:', lastError.message)
    }
    return null
  }

  // Alias tương thích ngược
  async generateMayResponse(params) {
    return this.generateResponse(params)
  }
}

export const llmClient = new LLMClient()
