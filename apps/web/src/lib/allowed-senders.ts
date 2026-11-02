import { z } from 'zod';

const senderSchema = z.email();

export function normalizeAllowedSender(raw: string): string {
  return raw.trim().toLowerCase();
}

export function parseAllowedSender(raw: string): { ok: true; value: string } | { ok: false } {
  const value = normalizeAllowedSender(raw);
  if (!value) return { ok: false };
  return senderSchema.safeParse(value).success ? { ok: true, value } : { ok: false };
}
