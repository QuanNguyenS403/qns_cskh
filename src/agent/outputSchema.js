/**
 * AGENT OUTPUT SCHEMA VALIDATOR (Blueprint §14.5, Prompt B §15, Phụ lục A)
 * 
 * Ứng dụng phải validate schema, độ dài, loại hành động và từng tham số
 * TRƯỚC KHI thực thi hoặc gửi tới khách hàng.
 */

import { z } from 'zod'

export const NextStepEnum = z.enum([
  'ASK_PRODUCT_ID',
  'ASK_FIT_PREFERENCE',
  'PROPOSE_ORDER',
  'AWAIT_CONFIRMATION',
  'VERIFY_IDENTITY',
  'OPEN_CASE',
  'HANDOFF',
  'INFORM',
  'CLOSE',
])

export const EmotionSignalEnum = z.enum([
  'neutral',
  'hesitant',
  'rushed',
  'anxious',
  'frustrated',
  'disappointed',
  'satisfied',
  'wants_to_stop',
  'angry',
  'positive',
  'empathetic',
  'curious',
  'warm_and_cozy',
  'excited',
  'cheerful',
]).or(z.string()).default('neutral')

export const ActionProposalSchema = z.object({
  tool: z.string().default('none'),
  args: z.record(z.any()).default({}),
  requires_customer_confirmation: z.boolean().default(false),
})

export const MemoryProposalSchema = z.object({
  attribute: z.string(),
  value: z.any(),
  source_message_id: z.string().optional().nullable(),
  purpose: z.string(),
  needs_consent: z.boolean().default(true),
})

export const PromiseProposalSchema = z.object({
  text: z.string(),
  due_at: z.string(), // ISO-8601
  owner: z.string().default('workflow'),
})

export const HandoffSchema = z.object({
  required: z.boolean().default(false),
  reason_code: z.string().nullable().default(null),
  priority: z.enum(['P0', 'P1', 'P2', 'P3']).default('P2'),
})

export const MayOutputSchema = z.object({
  customer_message: z.string().min(1, 'Nội dung tin nhắn gửi khách không được rỗng'),
  language: z.enum(['vi', 'en', 'other']).default('vi'),
  intent_codes: z.array(z.string()).default([]),
  next_step: NextStepEnum.default('INFORM'),
  action_proposals: z.array(ActionProposalSchema).default([]),
  evidence_refs: z.array(z.string()).default([]),
  memory_proposals: z.array(MemoryProposalSchema).default([]),
  promise_proposals: z.array(PromiseProposalSchema).default([]),
  handoff: HandoffSchema.default({ required: false, reason_code: null, priority: 'P2' }),
  needs_identity_verification: z.boolean().default(false),
  emotion_signal: EmotionSignalEnum.default('neutral'),
})

export function validateMayOutput(data) {
  return MayOutputSchema.safeParse(data)
}
