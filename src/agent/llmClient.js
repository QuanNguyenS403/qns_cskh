/**
 * LLM CLIENT FOR MAY CSKH AGENT (Google Gemini & Multi-Provider)
 * 
 * Kết nối trực tiếp đến Google Gemini API (gemini-3.8-flash / gemini-4-argon / gemini-3.6-flash)
 * sử dụng native fetch với cơ chế tự động Fallback kiên cường.
 * Đảm bảo cấu trúc đầu ra theo chuẩn JSON Schema Phụ lục A.
 */

import { config } from '../config/env.js'

export class LLMClient {
  constructor() {
    this.apiKey = config.GEMINI_API_KEY
    this.model = config.GEMINI_MODEL || 'gemini-3.8-flash'
    this.fallbackModel = config.GEMINI_FALLBACK_MODEL || 'gemini-3.6-flash'
    this.provider = config.LLM_PROVIDER || 'gemini'
  }

  /**
   * Gọi mô hình Google Gemini để sinh phản hồi cho May
   * 
   * @param {Object} params
   * @param {string} params.systemPrompt Prompt B toàn diện bao gồm cả Trusted Context
   * @param {string} params.userMessage Tin nhắn từ khách hàng (untrusted)
   * @param {Array} [params.history] Lịch sử hội thoại nếu có
   * @param {Function} [params.fetchImpl] Fetch implementation
   * @returns {Promise<Object|null>} May Output Object hoặc null nếu lỗi/chưa có API key
   */
  async generateMayResponse({
    systemPrompt,
    userMessage,
    history = [],
    fetchImpl = globalThis.fetch,
  }) {
    if (!this.apiKey) {
      return null
    }

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

    const requestBody = {
      system_instruction: {
        parts: [{ text: systemPrompt }],
      },
      contents,
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
        thinkingConfig: {
          thinkingLevel: 'low',
        },
      },
    }

    // Thử model chính trước, nếu gặp lỗi tải cao (503) hoặc vượt quota (429) sẽ tự động fallback
    const modelsToAttempt = [this.model]
    if (this.fallbackModel && this.fallbackModel !== this.model) {
      modelsToAttempt.push(this.fallbackModel)
    }

    let lastError = null

    for (const modelName of modelsToAttempt) {
      try {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`
        const controller = new AbortController()
        const timeoutMs = modelName === this.model && modelsToAttempt.length > 1 ? 12000 : 20000
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
          console.warn(`⚠️ [GEMINI ${modelName} HTTP ${response.status}]:`, errorText.slice(0, 200))
          // Nếu lỗi do 503 (quá tải) hoặc 429 (quota), tiếp tục thử fallback model tiếp theo
          if ((response.status === 503 || response.status === 429) && modelName !== modelsToAttempt[modelsToAttempt.length - 1]) {
            console.info(`🔄 [GEMINI FALLBACK] Tự động chuyển từ ${modelName} sang ${this.fallbackModel} do quá tải...`)
            continue
          }
          return null
        }

        const data = await response.json()
        const candidate = data.candidates?.[0]
        const rawText = candidate?.content?.parts?.find((p) => typeof p.text === 'string')?.text || candidate?.content?.parts?.[0]?.text

        if (!rawText) {
          console.warn(`⚠️ [GEMINI ${modelName} RESPONSE EMPTY]`)
          continue
        }

        // Parse JSON output
        try {
          const parsed = JSON.parse(rawText)
          return parsed
        } catch (jsonErr) {
          // Fallback: Tìm JSON block bằng regex
          const match = rawText.match(/\{[\s\S]*\}/)
          if (match) {
            return JSON.parse(match[0])
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
        }
      } catch (err) {
        lastError = err
        console.warn(`⚠️ [GEMINI ${modelName} EXCEPTION]:`, err.message)
        if (modelName !== modelsToAttempt[modelsToAttempt.length - 1]) {
          console.info(`🔄 [GEMINI FALLBACK] Tự động chuyển từ ${modelName} sang ${this.fallbackModel}...`)
          continue
        }
      }
    }

    if (lastError) {
      console.error('🚨 [GEMINI CLIENT FINAL EXCEPTION]:', lastError.message)
    }
    return null
  }
}

export const llmClient = new LLMClient()
