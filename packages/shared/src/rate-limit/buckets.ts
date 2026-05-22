/**
 * Bucket configurations. Capacity = burst size; refill = sustained rate.
 * Tune here, not at call sites.
 */
export const RATE_LIMITS = {
  /** /api/search: 30/min per userId. */
  search: { capacity: 30, refillPerSec: 30 / 60 },
  /** /api/chat: 20/min per userId. Chat is expensive (OpenRouter spend). */
  chat: { capacity: 20, refillPerSec: 20 / 60 },
  /** Telegram webhook: 60/min per tg_user_id. */
  telegramWebhook: { capacity: 60, refillPerSec: 60 / 60 },
  /** Postmark inbound: 120/min per From address. */
  emailInbound: { capacity: 120, refillPerSec: 120 / 60 },
  /** 401 lockout for Postmark inbound: 30/min per source IP. */
  emailInboundAuth: { capacity: 30, refillPerSec: 30 / 60 },
} as const;
