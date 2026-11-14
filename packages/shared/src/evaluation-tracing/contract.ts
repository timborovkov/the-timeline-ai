import { z } from 'zod';

export const EVALUATION_CONSENT_VERSION = '2026-11-14.1';
export const EVALUATION_SOURCES = ['telegram', 'email', 'github', 'google_drive', 'slack'] as const;
export const EVALUATION_SOURCE_LABELS: Record<(typeof EVALUATION_SOURCES)[number], string> = {
  telegram: 'Telegram',
  email: 'Email',
  github: 'GitHub',
  google_drive: 'Google Drive',
  slack: 'Slack',
};
export const evaluationPreferenceInput = z
  .object({
    enabled: z.boolean(),
    sources: z.array(z.enum(EVALUATION_SOURCES)).max(EVALUATION_SOURCES.length),
    consentVersion: z.string(),
    consent: z.boolean(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      v.enabled &&
      (!v.consent || v.consentVersion !== EVALUATION_CONSENT_VERSION || !v.sources.length)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Choose sources and acknowledge the current disclosure',
      });
  });
export function evaluationSource(source: string, metadata: unknown): string | null {
  if (source === 'telegram' || source === 'email' || source === 'slack') return source;
  if (source !== 'integration' || !metadata || typeof metadata !== 'object') return null;
  const provider = (metadata as Record<string, unknown>).provider;
  return provider === 'github' || provider === 'google_drive' || provider === 'slack'
    ? provider
    : null;
}
