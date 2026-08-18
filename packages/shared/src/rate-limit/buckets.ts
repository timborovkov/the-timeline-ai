/**
 * Bucket configurations. Capacity = burst size; refill = sustained rate.
 * Tune here, not at call sites.
 */
export const RATE_LIMITS = {
  /** Email/password signup: 5/min per source IP and per submitted email. */
  signup: { capacity: 5, refillPerSec: 5 / 60 },
  /** Email/password signin: 10/min per source IP and per submitted email. */
  signIn: { capacity: 10, refillPerSec: 10 / 60 },
  /** Public support/contact form: 3/min per source IP and per submitted email. */
  supportForm: { capacity: 3, refillPerSec: 3 / 60 },
  /** User-triggered email verification resend: 3/hour per user and email. */
  emailVerification: { capacity: 3, refillPerSec: 3 / 3600 },
  /** /api/search/global: 30/min per userId. */
  search: { capacity: 30, refillPerSec: 30 / 60 },
  /** /api/chat: 20/min per userId. Chat is expensive (OpenRouter spend). */
  aiChat: { capacity: 20, refillPerSec: 20 / 60 },
  /** Meeting bot scheduling: 10/min per userId. Provider joins are expensive. */
  meetingScheduling: { capacity: 10, refillPerSec: 10 / 60 },
  /** Document presigned upload requests: 30/min per userId. */
  documentUpload: { capacity: 30, refillPerSec: 30 / 60 },
  /** Document finalize requests: 30/min per userId. Finalize enqueues OCR. */
  documentFinalize: { capacity: 30, refillPerSec: 30 / 60 },
  /** Telegram webhook: 60/min per tg_user_id. */
  telegramWebhook: { capacity: 60, refillPerSec: 60 / 60 },
  /** Telegram /ask: 10/min per tg_user_id. Tighter than the webhook bucket
   *  because each /ask invokes the agent (OpenRouter spend). */
  telegramAsk: { capacity: 10, refillPerSec: 10 / 60 },
  /** Slack Events API: 300/min per source IP before signature verification. */
  slackWebhookIp: { capacity: 300, refillPerSec: 300 / 60 },
  /** Slack Events API: 120/min per Slack user/team after signature verification. */
  slackWebhookActor: { capacity: 120, refillPerSec: 120 / 60 },
  /** Slack /ask slash command: 10/min per Slack user because it invokes the agent. */
  slackAsk: { capacity: 10, refillPerSec: 10 / 60 },
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
  /** Phase 11 integration webhooks (Linear, Google Drive):
   *  300/min per source IP. Sits in front of the HMAC verify + DB lookup
   *  so a bogus-payload flood can't burn the worker's DB capacity. The
   *  cap is high enough to handle real bursts (a noisy monorepo can emit
   *  dozens of push events per minute) but low enough to choke a
   *  replay/forgery storm. */
  integrationWebhook: { capacity: 300, refillPerSec: 300 / 60 },
  /** Timeline-as-MCP-server endpoint: 600/min per source IP. */
  mcpServer: { capacity: 600, refillPerSec: 600 / 60 },
  /** Generic ingest webhooks: 300/min per credential for provider bursts. */
  ingestWebhook: { capacity: 300, refillPerSec: 300 / 60 },
  /** Per-connection extract LLM for conversational integrations (Slack, Drive).
   *  GitHub/Sentry/Linear/Monday skip this path entirely. */
  integrationExtract: { capacity: 20, refillPerSec: 20 / 60 },
  /** Per-connection embedding for every persisted integration event. */
  integrationEmbed: { capacity: 60, refillPerSec: 60 / 60 },
  /** Per-connection GitHub PR/issue task-proposal jobs. Cheap DB work, still
   *  bounded so a noisy repo cannot stampede the suggestions worker. */
  integrationGithubTaskProposal: { capacity: 30, refillPerSec: 30 / 60 },
  /** 401/lookup lockout for ingest webhooks: 60/min per source IP. */
  ingestWebhookAuth: { capacity: 60, refillPerSec: 60 / 60 },
} as const;
