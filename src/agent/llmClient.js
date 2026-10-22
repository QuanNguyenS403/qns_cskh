/**
 * LLM CLIENT FOR MAY CSKH AGENT (Google Gemini & Multi-Provider)
 * 
 * Kết nối trực tiếp đến Google Gemini API (gemini-2.5-flash / gemini-1.5-flash)
 * sử dụng native fetch. Đảm bảo cấu trúc đầu ra theo chuẩn JSON Schema Phụ lục A.
 */

import { config } from '../config/env.js'

export class LLMClient {
  constructor() {
    this.apiKey = config.GEMINI_API_KEY
    this.model = config.GEMINI_MODEL || 'gemini-2.5-flash'
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

    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`

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
          maxOutputTokens: 2048,
          responseMimeType: 'application/json',
        },
      }

      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error(`🚨 [GEMINI API ERROR HTTP ${response.status}]:`, errorText)
        return null
      }

      const data = await response.json()
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text

      if (!rawText) {
        console.warn('⚠️ [GEMINI RESPONSE EMPTY]')
        return null
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
        console.warn('⚠️ [GEMINI OUTPUT NOT VALID JSON]:', rawText)
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
      console.error('🚨 [GEMINI CLIENT EXCEPTION]:', err.message)
      return null
    }
  }
}

export const llmClient = new LLMClient()
