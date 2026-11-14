import { z } from 'zod';

export const DIAGNOSTIC_CONSENT_VERSION = '2026-11-14';
export const DIAGNOSTIC_TEXT_LIMIT = 60000;
export const diagnosticInput = z
  .object({
    sessionId: z.uuid(),
    description: z.string().trim().min(10).max(2000),
    conversation: z.string().trim().min(1).max(DIAGNOSTIC_TEXT_LIMIT),
    consent: z.literal(true),
    consentVersion: z.literal(DIAGNOSTIC_CONSENT_VERSION),
  })
  .strict();

// Only user-visible text. Never copy tool payloads, reasoning, attachments or system prompts.
export function diagnosticConversation(messages: { role: string; content: unknown }[]): string {
  return messages
    .flatMap(({ role, content }) => {
      if (role !== 'user' && role !== 'assistant') return [];
      if (!content || typeof content !== 'object') return [];
      const value = content as { ui_message?: { parts?: unknown }; text?: unknown };
      const parts = value.ui_message?.parts;
      const text = Array.isArray(parts)
        ? parts
            .flatMap((part: unknown) => {
              if (!part || typeof part !== 'object') return [];
              const p = part as { type?: unknown; text?: unknown };
              return p.type === 'text' && typeof p.text === 'string' ? [p.text] : [];
            })
            .join('\n')
        : role === 'assistant' && typeof value.text === 'string'
          ? value.text
          : '';
      return text ? [`${role === 'user' ? 'You' : 'Assistant'}:\n${text}`] : [];
    })
    .join('\n\n');
}

export const DIAGNOSTIC_PAGE_SIZE = 50;
export function diagnosticPage(value: unknown): number {
  const parsed = z.coerce.number().int().min(1).max(100000).safeParse(value);
  return parsed.success ? parsed.data : 1;
}
