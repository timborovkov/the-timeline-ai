import { createHmac } from 'node:crypto';

export type LiveIntegrationCanaryStatus = 'ok' | 'skip' | 'warn';

export interface LiveIntegrationCanaryResult {
  name: string;
  status: LiveIntegrationCanaryStatus;
  detail: string;
  action?: string;
  docs?: string;
  envKeys?: string[];
}

export interface LiveIntegrationCanaryReportInput {
  envFile: string;
  strict?: boolean;
  results: LiveIntegrationCanaryResult[];
  redactions?: readonly string[];
}

export interface LiveIntegrationCanaryCleanupInput {
  success: LiveIntegrationCanaryResult;
  cleanup: () => Promise<void>;
  formatError: (error: unknown) => string;
  action: string;
  docs?: string;
}

export interface PostmarkInboundCaptureCanaryPayloadInput {
  messageId: string;
  to: string;
  from: string;
  date: Date;
}

export interface SlackEventCaptureCanaryPayloadInput {
  eventId: string;
  teamId: string;
  channelId: string;
  userId: string;
  text: string;
  messageTs: string;
  eventTime: number;
}

export interface TelegramCaptureCanaryPayloadInput {
  updateId: number;
  messageId: number;
  userId: number;
  username?: string;
  firstName: string;
  text: string;
  date: number;
}

export interface TranscriptionCanaryWavInput {
  durationMs?: number;
  frequencyHz?: number;
  sampleRateHz?: number;
}

export const TRANSCRIPTION_SPEECH_CANARY_TEXT = 'Timeline Canary task';

export async function completeLiveIntegrationCanaryCleanup(
  input: LiveIntegrationCanaryCleanupInput,
): Promise<LiveIntegrationCanaryResult> {
  try {
    await input.cleanup();
    return input.success;
  } catch (error) {
    return {
      name: input.success.name,
      status: 'warn',
      detail: `cleanup failed: ${input.formatError(error)}`,
      action: input.action,
      ...(input.docs ? { docs: input.docs } : {}),
    };
  }
}

const TRANSCRIPTION_SPEECH_CANARY_MP3_BASE64 = [
  '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',
  'DFoloe6DeYc0fYWQoFmarRU6KjFFkVmqn01qPWtOC7WqsWAAhJoV5kgveCOi4wuiIAmqnYSkRhAQskWTgyxDtkRRwxEGLg48',
  'WYQI3ScmleFr//NIxDYoCt5YAZCIAIF7hjQsJFmGJHDnEkTSZrr7iDygOaSI8F26kDYvP/MmNiKjkkSJ0ok1UpzG3/0UDIpl',
  'wxMnSTLiHXr6lf/kyUh5DyilA2IOlHKJogY0CeOE8aJOkTJBSAkFJlZdPLER7+eqS1Y0SAIZ9UlVgcSCktmZx5mfVVvrfM84',
  'kwkLGliQeLqV//NIxBgZw6ngA8YoAISAYAhVDOUrGDxUMYzqIh0ylKWYwsyGepSl8xqlN+Y2n+UuhjMhnlobMZ9S8pdDaGep',
  'SupStQxm/X/l/mNmf///UpfQ1S1KUtDCx0O+WiVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV',
  'VVVVVVVVVVVV//NIxDQAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV',
  'VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV',
  'VVVVVVVVVVVV',
].join('');

export type PostmarkInboundCaptureCanaryUrlValidation =
  | { ok: true; url: URL }
  | { ok: false; reason: string };

export type SlackEventCaptureCanaryUrlValidation =
  | { ok: true; url: URL }
  | { ok: false; reason: string };

export type TelegramCaptureCanaryUrlValidation =
  | { ok: true; url: URL }
  | { ok: false; reason: string };

function statusLabel(status: LiveIntegrationCanaryStatus): string {
  return status.toUpperCase().padEnd(4);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

export function redactLiveIntegrationCanaryText(
  input: string,
  redactions: readonly string[] = [],
): string {
  let output = input;
  for (const value of redactions) {
    if (value.length < 8) continue;
    output = output.replace(new RegExp(escapeRegExp(value), 'gu'), '[redacted]');
    output = output.replace(
      new RegExp(escapeRegExp(encodeURIComponent(value)), 'gu'),
      '[redacted]',
    );
  }
  output = output.replace(/\b(Basic|Bearer|Token)\s+[A-Za-z0-9._~+/=-]{12,}/giu, '$1 [redacted]');
  output = output.replace(
    /\b(x-postmark-server-token|authorization)(["'\s:=]+)[^"',\s]+/giu,
    '$1$2[redacted]',
  );
  return output;
}

function actionFor(
  result: LiveIntegrationCanaryResult,
  redactions: readonly string[],
): string | null {
  if (result.status === 'ok') return null;
  const parts: string[] = [];
  if (result.action) parts.push(result.action);
  if (result.envKeys && result.envKeys.length > 0) {
    parts.push(`set ${result.envKeys.join(', ')}`);
  }
  if (result.docs) parts.push(`see ${result.docs}`);
  return redactLiveIntegrationCanaryText(
    parts.length > 0 ? parts.join('; ') : result.detail,
    redactions,
  );
}

export function formatLiveIntegrationCanaryReport(input: LiveIntegrationCanaryReportInput): string {
  const lines = [`Live integration canary (${input.envFile}${input.strict ? ', strict' : ''})`];
  const redactions = input.redactions ?? [];
  for (const result of input.results) {
    lines.push(
      `${statusLabel(result.status)} ${result.name}: ${redactLiveIntegrationCanaryText(
        result.detail,
        redactions,
      )}`,
    );
  }

  const actionable = input.results
    .map((result) => ({ result, action: actionFor(result, redactions) }))
    .filter((item): item is { result: LiveIntegrationCanaryResult; action: string } =>
      Boolean(item.action),
    );
  if (actionable.length > 0) {
    lines.push('');
    lines.push('Next steps:');
    for (const { result, action } of actionable) {
      lines.push(`- ${result.name}: ${action}`);
    }
  }

  return lines.join('\n');
}

export function buildPostmarkInboundCaptureCanaryPayload(
  input: PostmarkInboundCaptureCanaryPayloadInput,
): Record<string, unknown> {
  const subject = `Timeline inbound canary ${input.date.toISOString()}`;
  return {
    MessageID: input.messageId,
    Date: input.date.toISOString(),
    Subject: subject,
    From: `Timeline Canary <${input.from}>`,
    FromName: 'Timeline Canary',
    FromFull: { Email: input.from, Name: 'Timeline Canary', MailboxHash: '' },
    To: input.to,
    ToFull: [{ Email: input.to, Name: 'Timeline Canary Team', MailboxHash: '' }],
    Cc: '',
    CcFull: [],
    Bcc: '',
    BccFull: [],
    OriginalRecipient: input.to,
    ReplyTo: input.from,
    MailboxHash: '',
    TextBody: [
      'Timeline inbound canary.',
      `Message: ${input.messageId}`,
      'This synthetic Postmark-shaped payload verifies capture into raw_events.',
    ].join('\n'),
    HtmlBody: '',
    StrippedTextReply: '',
    Tag: 'timeline-canary',
    Headers: [{ Name: 'Message-ID', Value: `<${input.messageId}>` }],
    Attachments: [],
  };
}

export function buildSlackEventCaptureCanaryPayload(
  input: SlackEventCaptureCanaryPayloadInput,
): Record<string, unknown> {
  return {
    type: 'event_callback',
    team_id: input.teamId,
    event_id: input.eventId,
    event_time: input.eventTime,
    event: {
      type: 'message',
      channel: input.channelId,
      channel_type: 'channel',
      user: input.userId,
      text: input.text,
      ts: input.messageTs,
      event_ts: input.messageTs,
    },
  };
}

export function buildTelegramCaptureCanaryPayload(
  input: TelegramCaptureCanaryPayloadInput,
): Record<string, unknown> {
  const from: Record<string, unknown> = {
    id: input.userId,
    is_bot: false,
    first_name: input.firstName,
  };
  if (input.username) from.username = input.username;
  return {
    update_id: input.updateId,
    message: {
      message_id: input.messageId,
      date: input.date,
      chat: { id: input.userId, type: 'private' },
      from,
      text: `/note ${input.text}`,
    },
  };
}

export function buildTranscriptionCanaryWav(input: TranscriptionCanaryWavInput = {}): Buffer {
  const durationMs = input.durationMs ?? 400;
  const frequencyHz = input.frequencyHz ?? 440;
  const sampleRateHz = input.sampleRateHz ?? 16_000;
  const sampleCount = Math.max(1, Math.floor((sampleRateHz * durationMs) / 1000));
  const bytesPerSample = 2;
  const channelCount = 1;
  const dataSize = sampleCount * bytesPerSample * channelCount;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channelCount, 22);
  buffer.writeUInt32LE(sampleRateHz, 24);
  buffer.writeUInt32LE(sampleRateHz * channelCount * bytesPerSample, 28);
  buffer.writeUInt16LE(channelCount * bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < sampleCount; i++) {
    const envelope = Math.sin((Math.PI * i) / sampleCount);
    const sample = Math.sin((2 * Math.PI * frequencyHz * i) / sampleRateHz) * envelope * 0.18;
    buffer.writeInt16LE(Math.round(sample * 32767), 44 + i * bytesPerSample);
  }

  return buffer;
}

export function buildSpeechTranscriptionCanaryMp3(): Buffer {
  return Buffer.from(TRANSCRIPTION_SPEECH_CANARY_MP3_BASE64, 'base64');
}

export function isExpectedSpeechTranscriptionCanaryText(text: string): boolean {
  const normalized = text.toLowerCase();
  return ['timeline', 'canary', 'task'].every((term) => normalized.includes(term));
}

export function signSlackCanaryRequest(input: {
  signingSecret: string;
  timestamp: string;
  body: string;
}): string {
  return `v0=${createHmac('sha256', input.signingSecret)
    .update(`v0:${input.timestamp}:${input.body}`)
    .digest('hex')}`;
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '[::1]';
}

export function validatePostmarkInboundCaptureCanaryUrl(
  baseUrl: string | undefined,
  allowedOrigin: string | undefined,
): PostmarkInboundCaptureCanaryUrlValidation {
  if (!baseUrl?.trim()) return { ok: false, reason: 'AUTH_URL missing' };
  let url: URL;
  try {
    url = new URL('/api/email/inbound', baseUrl);
  } catch {
    return { ok: false, reason: 'AUTH_URL is not a valid URL' };
  }
  if (url.protocol === 'http:' && isLoopbackHostname(url.hostname)) return { ok: true, url };
  if (url.protocol === 'https:') {
    if (!allowedOrigin?.trim()) {
      return {
        ok: false,
        reason: 'POSTMARK_INBOUND_CANARY_ALLOWED_ORIGIN must match AUTH_URL origin',
      };
    }
    let expected: URL;
    try {
      expected = new URL(allowedOrigin);
    } catch {
      return {
        ok: false,
        reason: 'POSTMARK_INBOUND_CANARY_ALLOWED_ORIGIN is not a valid URL',
      };
    }
    if (expected.origin !== url.origin) {
      return {
        ok: false,
        reason: 'POSTMARK_INBOUND_CANARY_ALLOWED_ORIGIN does not match AUTH_URL origin',
      };
    }
    return { ok: true, url };
  }
  return {
    ok: false,
    reason: 'AUTH_URL must be HTTPS, except localhost HTTP for development',
  };
}

export function validateSlackEventCaptureCanaryUrl(
  baseUrl: string | undefined,
  allowedOrigin: string | undefined,
): SlackEventCaptureCanaryUrlValidation {
  if (!baseUrl?.trim()) return { ok: false, reason: 'AUTH_URL missing' };
  let url: URL;
  try {
    url = new URL('/api/slack/events', baseUrl);
  } catch {
    return { ok: false, reason: 'AUTH_URL is not a valid URL' };
  }
  if (url.protocol === 'http:' && isLoopbackHostname(url.hostname)) return { ok: true, url };
  if (url.protocol === 'https:') {
    if (!allowedOrigin?.trim()) {
      return {
        ok: false,
        reason: 'SLACK_CAPTURE_CANARY_ALLOWED_ORIGIN must match AUTH_URL origin',
      };
    }
    let expected: URL;
    try {
      expected = new URL(allowedOrigin);
    } catch {
      return {
        ok: false,
        reason: 'SLACK_CAPTURE_CANARY_ALLOWED_ORIGIN is not a valid URL',
      };
    }
    if (expected.origin !== url.origin) {
      return {
        ok: false,
        reason: 'SLACK_CAPTURE_CANARY_ALLOWED_ORIGIN does not match AUTH_URL origin',
      };
    }
    return { ok: true, url };
  }
  return {
    ok: false,
    reason: 'AUTH_URL must be HTTPS, except localhost HTTP for development',
  };
}

export function validateTelegramCaptureCanaryUrl(
  baseUrl: string | undefined,
  allowedOrigin: string | undefined,
): TelegramCaptureCanaryUrlValidation {
  if (!baseUrl?.trim()) return { ok: false, reason: 'AUTH_URL missing' };
  let url: URL;
  try {
    url = new URL('/api/telegram/webhook', baseUrl);
  } catch {
    return { ok: false, reason: 'AUTH_URL is not a valid URL' };
  }
  if (url.protocol === 'http:' && isLoopbackHostname(url.hostname)) return { ok: true, url };
  if (url.protocol === 'https:') {
    if (!allowedOrigin?.trim()) {
      return {
        ok: false,
        reason: 'TELEGRAM_CAPTURE_CANARY_ALLOWED_ORIGIN must match AUTH_URL origin',
      };
    }
    let expected: URL;
    try {
      expected = new URL(allowedOrigin);
    } catch {
      return {
        ok: false,
        reason: 'TELEGRAM_CAPTURE_CANARY_ALLOWED_ORIGIN is not a valid URL',
      };
    }
    if (expected.origin !== url.origin) {
      return {
        ok: false,
        reason: 'TELEGRAM_CAPTURE_CANARY_ALLOWED_ORIGIN does not match AUTH_URL origin',
      };
    }
    return { ok: true, url };
  }
  return {
    ok: false,
    reason: 'AUTH_URL must be HTTPS, except localhost HTTP for development',
  };
}
