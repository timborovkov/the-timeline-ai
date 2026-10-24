import type {
  JoinMeetingInput,
  JoinMeetingResult,
  MeetingBotProvider,
  MeetingBotStatus,
} from '#src/meeting-bots/types.js';

import { getEnv } from '#src/env.js';
import { childLogger } from '#src/logger.js';

// Recall.ai adapter: single bot per meeting, silent mode (no audio/video
// output), realtime webhooks for transcript + status, metadata round-trip
// of meetingId so webhooks can locate the meeting without trusting URLs.
//
// Design notes for this phase:
//   * Single-team Qdrant collection (handled at the embed worker, not here).
//   * No voice / agent mode this phase — `output_media` and voice secrets
//     are deliberately omitted. Phase 10 is silent capture only.
//
// Errors throw; the caller decides whether to mark the meeting failed or
// surface a server-action error to the user.

const log = childLogger('shared:meeting-bots:recall');
const MEET_NO_SHOW_TIMEOUT_SECONDS = 550;
const DEFAULT_NO_SHOW_TIMEOUT_SECONDS = 15 * 60;

interface RecallProviderOptions {
  /** Override the configured API key. Tests pass a stub. */
  apiKey?: string;
  /** Override the base URL. Defaults to env. */
  baseUrl?: string;
  /** Display name for the bot in the participant list. */
  botName?: string;
  /** Inject fetch for tests. */
  fetcher?: typeof fetch;
}

interface RecallBotResponse {
  id: string;
  status?: { code?: string; created_at?: string };
  status_changes?: { code: string; created_at: string }[];
  meeting_url?: { meeting_id?: string };
}

export interface RecallListBotsCanaryResult {
  returnedCount: number | null;
}

type RecallRetentionConfig = { type: 'timed'; hours: number } | { type: 'forever' };

function resolveRetention(value: string | undefined): RecallRetentionConfig {
  const normalized = value?.trim().toLowerCase();
  if (normalized === undefined || normalized === '') return { type: 'timed', hours: 1 };
  if (normalized === 'forever') return { type: 'forever' };
  const hours = Number(normalized);
  if (Number.isInteger(hours) && hours > 0) return { type: 'timed', hours };
  throw new Error('RECALL_RETENTION must be empty, forever, or a positive whole number of hours');
}

function mapStatus(code: string | undefined): MeetingBotStatus['status'] {
  // Recall's published lifecycle codes — collapsed onto our six-state enum.
  // Unrecognised values are treated as 'active' so a new code Recall ships
  // doesn't accidentally fail the meeting.
  switch (code) {
    case 'ready':
    case 'joining_call':
      return 'joining';
    case 'in_call_recording':
    case 'in_call_not_recording':
    case 'in_waiting_room':
      return 'active';
    case 'call_ended':
    case 'processing':
    case 'analysis_in_progress':
      return 'processing';
    case 'done':
    case 'analysis_done':
      return 'completed';
    case 'fatal':
    case 'failed':
    case 'recording_permission_denied':
      return 'failed';
    default:
      return 'active';
  }
}

export async function listRecallBotsForCanary(
  opts: RecallProviderOptions & { joinAtAfter?: Date } = {},
): Promise<RecallListBotsCanaryResult> {
  const env = getEnv();
  const apiKey = opts.apiKey ?? env.RECALL_API_KEY;
  if (!apiKey) {
    throw new Error('RECALL_API_KEY is required to run the Recall canary');
  }
  const baseUrl = (opts.baseUrl ?? env.RECALL_BASE_URL).replace(/\/$/, '');
  const url = new URL(`${baseUrl}/bot/`);
  url.searchParams.set('join_at_after', (opts.joinAtAfter ?? new Date()).toISOString());
  url.searchParams.set('limit', '1');
  const fetcher = opts.fetcher ?? fetch;
  const res = await fetcher(url, {
    method: 'GET',
    headers: {
      Authorization: `Token ${apiKey}`,
      accept: 'application/json',
    },
  });
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const detail = typeof data === 'string' ? data : JSON.stringify(data);
    throw new Error(`Recall GET /bot/ failed: ${String(res.status)} ${detail}`);
  }
  const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const results = Array.isArray(record.results) ? record.results : null;
  return { returnedCount: results?.length ?? null };
}

export function createRecallProvider(opts: RecallProviderOptions = {}): MeetingBotProvider {
  const env = getEnv();
  const apiKey = opts.apiKey ?? env.RECALL_API_KEY;
  if (!apiKey) {
    throw new Error('RECALL_API_KEY is required to construct the Recall provider');
  }
  const baseUrl = (opts.baseUrl ?? env.RECALL_BASE_URL).replace(/\/$/, '');
  const botName = opts.botName ?? env.RECALL_BOT_DISPLAY_NAME;
  const retention = resolveRetention(env.RECALL_RETENTION);
  const fetcher = opts.fetcher ?? fetch;

  async function request(method: string, path: string, body?: unknown): Promise<unknown> {
    const init: RequestInit = {
      method,
      headers: {
        // Recall uses Token-prefixed Authorization, NOT Bearer.
        Authorization: `Token ${apiKey}`,
        'content-type': 'application/json',
      },
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await fetcher(`${baseUrl}${path}`, init);
    const text = await res.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    // 404 on leaveMeeting is tolerated by the caller; bubble status so the
    // wrapper can decide. Anything else non-2xx throws.
    if (!res.ok && res.status !== 404) {
      const detail = typeof data === 'string' ? data : JSON.stringify(data);
      const err = new Error(`Recall ${method} ${path} failed: ${String(res.status)} ${detail}`);
      (err as { status?: number }).status = res.status;
      throw err;
    }
    if (data === null || typeof data !== 'object') data = {};
    (data as { __status?: number }).__status = res.status;
    return data;
  }

  return {
    name: 'recall',

    async joinMeeting(input: JoinMeetingInput): Promise<JoinMeetingResult> {
      // Keep Recall's multilingual accuracy path. Zero retention is rejected
      // by config because Recall does not support it with prioritize_accuracy.
      const recallStreamingProvider = {
        mode: 'prioritize_accuracy',
        language_code: 'auto',
      };

      const body = {
        meeting_url: input.meetingUrl,
        bot_name: input.botName ?? botName,
        automatic_leave: {
          waiting_room_timeout:
            input.platform === 'meet'
              ? MEET_NO_SHOW_TIMEOUT_SECONDS
              : DEFAULT_NO_SHOW_TIMEOUT_SECONDS,
          noone_joined_timeout:
            input.platform === 'meet'
              ? MEET_NO_SHOW_TIMEOUT_SECONDS
              : DEFAULT_NO_SHOW_TIMEOUT_SECONDS,
          everyone_left_timeout: { timeout: 2, activate_after: 1 },
          recording_permission_denied_timeout: 30,
          ...(input.maxRecordingDurationSeconds && input.maxRecordingDurationSeconds > 0
            ? { in_call_recording_timeout: input.maxRecordingDurationSeconds }
            : {}),
        },
        metadata: {
          meeting_id: input.meetingId,
          team_id: input.teamId,
          platform: input.platform,
        },
        realtime_endpoints: [
          {
            type: 'webhook',
            url: input.transcriptWebhookUrl,
            events: ['transcript.data', 'transcript.partial_data'],
          },
        ],
        recording_config: {
          retention,
          transcript: { provider: { recallai_streaming: recallStreamingProvider } },
          realtime_endpoints: [
            {
              type: 'webhook',
              url: input.transcriptWebhookUrl,
              events: ['transcript.data'],
            },
          ],
        },
      };
      const data = (await request('POST', '/bot', body)) as RecallBotResponse;
      if (!data.id) throw new Error('Recall joinMeeting: missing id in response');
      log.info(
        { meetingId: input.meetingId, botId: data.id, platform: input.platform },
        'recall_bot_created',
      );
      return { botId: data.id, raw: data as unknown as Record<string, unknown> };
    },

    async leaveMeeting(botId: string): Promise<void> {
      try {
        await request('POST', `/bot/${encodeURIComponent(botId)}/leave_call`);
      } catch (err: unknown) {
        const status = (err as { status?: number }).status;
        // 404 means the bot has already left or never joined; treat as
        // success so re-leave is idempotent.
        if (status === 404) return;
        throw err;
      }
    },

    async getStatus(botId: string): Promise<MeetingBotStatus> {
      const data = (await request(
        'GET',
        `/bot/${encodeURIComponent(botId)}/`,
      )) as RecallBotResponse;
      const code = data.status?.code;
      const status = mapStatus(code);
      const startedAt = data.status_changes?.find(
        (c) => mapStatus(c.code) === 'active',
      )?.created_at;
      const endedAt = data.status_changes?.find(
        (c) => mapStatus(c.code) === 'processing',
      )?.created_at;
      const result: MeetingBotStatus = { status };
      if (code !== undefined) result.rawStatus = code;
      if (startedAt) result.startedAt = new Date(startedAt);
      if (endedAt) result.endedAt = new Date(endedAt);
      return result;
    },
  };
}

export { mapStatus as recallMapStatus };
