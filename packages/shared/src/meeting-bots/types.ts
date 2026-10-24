// Phase 10 — Meeting bot provider interface.
//
// One provider implementation per backend (Recall.ai today; Attendee.dev /
// Meeting BaaS / native Meet/Teams APIs in the future). Callers go through
// `getMeetingBotProvider()` and never reference Recall types directly, so a
// later swap is a one-file change.

export type MeetingPlatform = 'meet' | 'teams' | 'zoom';

export interface JoinMeetingInput {
  /** Internal meeting id used only for local logs and state correlation. */
  meetingId: string;
  /** Internal team id used by Timeline's scoped persistence layer only. */
  teamId: string;
  meetingUrl: string;
  platform: MeetingPlatform;
  /** Display name the bot uses in the participant list. */
  botName?: string;
  /** Transcript webhook the provider should call. Required because Recall
   *  configures it per-bot, not per-account. */
  transcriptWebhookUrl: string;
}

export interface JoinMeetingResult {
  /** Provider's id for the bot — used to correlate later webhooks. */
  botId: string;
}

export interface MeetingBotStatus {
  /** Provider-reported lifecycle bucket, normalised onto our enum. */
  status: 'pending' | 'joining' | 'active' | 'processing' | 'completed' | 'failed';
  /** Provider's raw status string for audit. */
  rawStatus?: string;
  startedAt?: Date | null;
  endedAt?: Date | null;
}

export interface MeetingBotProvider {
  /** Provider tag (e.g. 'recall'). Mirrors `meetings.provider`. */
  readonly name: string;
  /** Schedule the bot. The provider is responsible for joining; we just
   *  hold onto the returned botId so webhooks can find the meeting. */
  joinMeeting(input: JoinMeetingInput): Promise<JoinMeetingResult>;
  /** Ask the provider to leave / cancel a scheduled bot. Idempotent — safe
   *  to call after the bot already left. */
  leaveMeeting(botId: string): Promise<void>;
  /** Fetch current status. Used as a fallback when status webhooks are
   *  delayed or lost. */
  getStatus(botId: string): Promise<MeetingBotStatus>;
}

/**
 * Return a content-free category suitable for persisted meeting metadata.
 * Provider response bodies and exception messages may echo meeting URLs or
 * other customer content, so callers must never persist them verbatim.
 */
export function meetingBotErrorCode(error: unknown): string {
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599) {
    return `provider_http_${String(status)}`;
  }
  if (error instanceof Error && error.name === 'AbortError') return 'provider_timeout';
  return 'provider_request_failed';
}
