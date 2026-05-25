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
  /** Telegram /ask: 10/min per tg_user_id. Tighter than the webhook bucket
   *  because each /ask invokes the agent (OpenRouter spend). */
  telegramAsk: { capacity: 10, refillPerSec: 10 / 60 },
  /** Postmark inbound: 120/min per From address. */
  emailInbound: { capacity: 120, refillPerSec: 120 / 60 },
  /** 401 lockout for Postmark inbound: 30/min per source IP. */
  emailInboundAuth: { capacity: 30, refillPerSec: 30 / 60 },
  /** Recall.ai transcript webhook: 600/min per bot. Bots stream many small
   *  utterance groups; the cap is high to avoid clipping legitimate meetings
   *  but low enough to choke a replay storm. */
  recallTranscript: { capacity: 600, refillPerSec: 600 / 60 },
  /** Pre-lookup gate on the transcript webhook: 200/min per source IP.
   *  Sits in front of the meeting lookup so an attacker rotating random
   *  botIds can't burn DB capacity. Lower than the per-bot bucket because
   *  Recall delivers from a small IP pool; the per-bot bucket handles
   *  per-meeting burst. */
  recallTranscriptIp: { capacity: 200, refillPerSec: 200 / 60 },
} as const;
