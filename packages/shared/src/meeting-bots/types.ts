// Phase 10 — Meeting bot provider interface.
//
// One provider implementation per backend (Recall.ai today; Attendee.dev /
// Meeting BaaS / native Meet/Teams APIs in the future). Callers go through
// `getMeetingBotProvider()` and never reference Recall types directly, so a
// later swap is a one-file change.

export type MeetingPlatform = 'meet' | 'teams' | 'zoom';

export interface JoinMeetingInput {
  /** Internal meeting id. Round-tripped through provider metadata so
   *  webhooks can look the meeting up without trusting URLs or names. */
  meetingId: string;
  teamId: string;
  meetingUrl: string;
  platform: MeetingPlatform;
  /** Display name the bot uses in the participant list. */
  botName?: string;
  /** Transcript webhook the provider should call. Required because Recall
   *  configures it per-bot, not per-account. */
  transcriptWebhookUrl: string;
  /** ISO-639-1 language hint for transcription (e.g. 'fi', 'en'). When
   *  set, Recall uses its own transcription engine with the language hint
   *  instead of the platform's built-in captions. */
  language?: string;
}

export interface JoinMeetingResult {
  /** Provider's id for the bot — used to correlate later webhooks. */
  botId: string;
  /** Any provider-specific opaque blob worth persisting on the meeting row.
   *  Stored under `meetings.metadata.provider_join_result` verbatim. */
  raw?: Record<string, unknown>;
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
