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

export interface PostmarkInboundCaptureCanaryPayloadInput {
  messageId: string;
  to: string;
  from: string;
  date: Date;
}

export type PostmarkInboundCaptureCanaryUrlValidation =
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
