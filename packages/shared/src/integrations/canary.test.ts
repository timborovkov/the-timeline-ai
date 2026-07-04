import { describe, expect, it } from 'vitest';

import {
  TRANSCRIPTION_SPEECH_CANARY_TEXT,
  buildSpeechTranscriptionCanaryMp3,
  buildPostmarkInboundCaptureCanaryPayload,
  buildSlackEventCaptureCanaryPayload,
  buildTelegramCaptureCanaryPayload,
  buildTranscriptionCanaryWav,
  formatLiveIntegrationCanaryReport,
  isExpectedSpeechTranscriptionCanaryText,
  redactLiveIntegrationCanaryText,
  signSlackCanaryRequest,
  validatePostmarkInboundCaptureCanaryUrl,
  validateSlackEventCaptureCanaryUrl,
  validateTelegramCaptureCanaryUrl,
} from '#src/integrations/canary.js';

describe('live integration canary report formatting', () => {
  it('prints status rows and actionable next steps without exposing secrets', () => {
    const report = formatLiveIntegrationCanaryReport({
      envFile: '/path/to/.env',
      strict: true,
      results: [
        {
          name: 'OpenRouter',
          status: 'ok',
          detail: 'shared structured LLM path succeeded',
        },
        {
          name: 'GitHub App',
          status: 'skip',
          detail: 'GITHUB_APP_ID or GITHUB_APP_PRIVATE_KEY missing',
          action: 'configure GitHub App installation-token credentials',
          envKeys: ['GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY'],
          docs: 'docs/setup/integrations.html#github',
        },
        {
          name: 'Sentry API',
          status: 'warn',
          detail: 'status 403: You do not have permission',
          action: 'grant the Sentry token project:read access to the configured project',
          docs: 'docs/setup/sentry.html',
        },
        {
          name: 'Postmark API',
          status: 'ok',
          detail: 'server lookup succeeded',
        },
      ],
    });

    expect(report).toContain('Live integration canary (/path/to/.env, strict)');
    expect(report).toContain('OK   OpenRouter: shared structured LLM path succeeded');
    expect(report).toContain('OK   Postmark API: server lookup succeeded');
    expect(report).toContain('SKIP GitHub App: GITHUB_APP_ID or GITHUB_APP_PRIVATE_KEY missing');
    expect(report).toContain('WARN Sentry API: status 403: You do not have permission');
    expect(report).toContain('Next steps:');
    expect(report).toContain(
      '- GitHub App: configure GitHub App installation-token credentials; set GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY; see docs/setup/integrations.html#github',
    );
    expect(report).toContain(
      '- Sentry API: grant the Sentry token project:read access to the configured project; see docs/setup/sentry.html',
    );
    expect(report).not.toContain('ghp_');
    expect(report).not.toContain('secret=');
    expect(report).not.toContain('POSTMARK_SERVER_TOKEN=');
  });

  it('omits the next-steps section when every check is ok', () => {
    expect(
      formatLiveIntegrationCanaryReport({
        envFile: '.env',
        results: [{ name: 'OpenRouter', status: 'ok', detail: 'ok' }],
      }),
    ).toBe('Live integration canary (.env)\nOK   OpenRouter: ok');
  });

  it('redacts configured secrets and generic authorization tokens from report text', () => {
    const secret = 'pm-secret-value-123456';
    const report = formatLiveIntegrationCanaryReport({
      envFile: '.env',
      redactions: [secret],
      results: [
        {
          name: 'Postmark API',
          status: 'warn',
          detail: `status 401: token ${secret} rejected`,
        },
        {
          name: 'Fallback',
          status: 'warn',
          detail: [
            'Authorization: Bearer abcdefghijklmnopqrstuvwxyz',
            'Authorization: Basic cG9zdG1hcms6cG0tc2VjcmV0LXZhbHVlLTEyMzQ1Ng==',
          ].join('\n'),
        },
      ],
    });

    expect(report).not.toContain(secret);
    expect(report).not.toContain('abcdefghijklmnopqrstuvwxyz');
    expect(report).not.toContain('cG9zdG1hcms6cG0tc2VjcmV0LXZhbHVlLTEyMzQ1Ng==');
    expect(report).toContain('token [redacted] rejected');
    expect(report).toContain('Authorization: [redacted] [redacted]');
  });
});

describe('redactLiveIntegrationCanaryText', () => {
  it('redacts encoded secret values and sensitive headers', () => {
    expect(
      redactLiveIntegrationCanaryText(
        'x-postmark-server-token: pm-token-1234567890 and token%2Fwith%2Fslash',
        ['token/with/slash'],
      ),
    ).toBe('x-postmark-server-token: [redacted] and [redacted]');
  });
});

describe('buildPostmarkInboundCaptureCanaryPayload', () => {
  it('builds a Postmark-shaped payload for the inbound capture route', () => {
    const payload = buildPostmarkInboundCaptureCanaryPayload({
      messageId: 'timeline-canary@example.test',
      to: 'team-a@inbound.test',
      from: 'canary@example.test',
      date: new Date('2026-07-01T12:00:00.000Z'),
    });

    expect(payload).toMatchObject({
      MessageID: 'timeline-canary@example.test',
      Subject: 'Timeline inbound canary 2026-07-01T12:00:00.000Z',
      FromFull: { Email: 'canary@example.test', Name: 'Timeline Canary' },
      ToFull: [{ Email: 'team-a@inbound.test', Name: 'Timeline Canary Team' }],
      OriginalRecipient: 'team-a@inbound.test',
      Tag: 'timeline-canary',
      Attachments: [],
    });
    expect(payload.TextBody).toContain('timeline-canary@example.test');
    expect(payload.Headers).toEqual([
      { Name: 'Message-ID', Value: '<timeline-canary@example.test>' },
    ]);
  });
});

describe('buildSlackEventCaptureCanaryPayload', () => {
  it('builds a Slack event-callback payload for capture canaries', () => {
    expect(
      buildSlackEventCaptureCanaryPayload({
        eventId: 'EvCanary',
        teamId: 'T123',
        channelId: 'C123',
        userId: 'U123',
        text: 'Timeline Slack capture canary',
        messageTs: '1780000000.123456',
        eventTime: 1_780_000_000,
      }),
    ).toEqual({
      type: 'event_callback',
      team_id: 'T123',
      event_id: 'EvCanary',
      event_time: 1_780_000_000,
      event: {
        type: 'message',
        channel: 'C123',
        channel_type: 'channel',
        user: 'U123',
        text: 'Timeline Slack capture canary',
        ts: '1780000000.123456',
        event_ts: '1780000000.123456',
      },
    });
  });
});

describe('buildTelegramCaptureCanaryPayload', () => {
  it('builds a Telegram private-message update for capture canaries', () => {
    expect(
      buildTelegramCaptureCanaryPayload({
        updateId: 1_780_000_001,
        messageId: 42,
        userId: 710_000_001,
        username: 'timeline_canary',
        firstName: 'Timeline',
        text: 'Timeline Telegram capture canary',
        date: 1_780_000_000,
      }),
    ).toEqual({
      update_id: 1_780_000_001,
      message: {
        message_id: 42,
        date: 1_780_000_000,
        chat: { id: 710_000_001, type: 'private' },
        from: {
          id: 710_000_001,
          is_bot: false,
          first_name: 'Timeline',
          username: 'timeline_canary',
        },
        text: 'Timeline Telegram capture canary',
      },
    });
  });
});

describe('buildTranscriptionCanaryWav', () => {
  it('builds a small PCM WAV buffer for live transcription canaries', () => {
    const wav = buildTranscriptionCanaryWav({
      durationMs: 250,
      frequencyHz: 880,
      sampleRateHz: 8_000,
    });

    expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(wav.subarray(8, 12).toString('ascii')).toBe('WAVE');
    expect(wav.subarray(12, 16).toString('ascii')).toBe('fmt ');
    expect(wav.readUInt16LE(20)).toBe(1);
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(24)).toBe(8_000);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.subarray(36, 40).toString('ascii')).toBe('data');
    expect(wav.readUInt32LE(40)).toBe(wav.byteLength - 44);
    expect(wav.byteLength).toBe(44 + 2_000 * 2);
  });
});

describe('buildSpeechTranscriptionCanaryMp3', () => {
  it('builds a tiny spoken MP3 fixture for live transcription canaries', () => {
    const mp3 = buildSpeechTranscriptionCanaryMp3();

    expect(TRANSCRIPTION_SPEECH_CANARY_TEXT).toBe('Timeline Canary task');
    expect(mp3.subarray(0, 3).toString('ascii')).toBe('ID3');
    expect(mp3.byteLength).toBeGreaterThan(4_000);
    expect(mp3.byteLength).toBeLessThan(8_000);
  });

  it('matches expected speech canary transcripts semantically', () => {
    expect(isExpectedSpeechTranscriptionCanaryText('Timeline Canary task.')).toBe(true);
    expect(isExpectedSpeechTranscriptionCanaryText('timeline canary: create a task')).toBe(true);
    expect(isExpectedSpeechTranscriptionCanaryText('audio endpoint returned text')).toBe(false);
  });
});

describe('signSlackCanaryRequest', () => {
  it('signs the exact request body with Slack v0 HMAC format', () => {
    const body = JSON.stringify({ type: 'event_callback', event_id: 'EvCanary' });

    expect(
      signSlackCanaryRequest({
        signingSecret: 'slack-secret',
        timestamp: '1780000000',
        body,
      }),
    ).toBe('v0=b3bb3da7e1b4dcf99ffbc56b257ed453ef5e101bf0a720690ed5ab989646c11e');
  });
});

describe('validatePostmarkInboundCaptureCanaryUrl', () => {
  it('allows explicitly confirmed HTTPS app origins and localhost HTTP development origins', () => {
    expect(
      validatePostmarkInboundCaptureCanaryUrl(
        'https://timeline.example/app',
        'https://timeline.example',
      ),
    ).toMatchObject({
      ok: true,
      url: new URL('https://timeline.example/api/email/inbound'),
    });
    expect(
      validatePostmarkInboundCaptureCanaryUrl('http://localhost:3000', undefined),
    ).toMatchObject({
      ok: true,
      url: new URL('http://localhost:3000/api/email/inbound'),
    });
  });

  it('rejects missing, malformed, and non-local HTTP origins before secrets are sent', () => {
    expect(validatePostmarkInboundCaptureCanaryUrl(undefined, undefined)).toEqual({
      ok: false,
      reason: 'AUTH_URL missing',
    });
    expect(
      validatePostmarkInboundCaptureCanaryUrl('not a url', 'https://timeline.example'),
    ).toEqual({
      ok: false,
      reason: 'AUTH_URL is not a valid URL',
    });
    expect(validatePostmarkInboundCaptureCanaryUrl('http://timeline.example', undefined)).toEqual({
      ok: false,
      reason: 'AUTH_URL must be HTTPS, except localhost HTTP for development',
    });
    expect(validatePostmarkInboundCaptureCanaryUrl('https://timeline.example', undefined)).toEqual({
      ok: false,
      reason: 'POSTMARK_INBOUND_CANARY_ALLOWED_ORIGIN must match AUTH_URL origin',
    });
    expect(
      validatePostmarkInboundCaptureCanaryUrl('https://timeline.example', 'https://other.example'),
    ).toEqual({
      ok: false,
      reason: 'POSTMARK_INBOUND_CANARY_ALLOWED_ORIGIN does not match AUTH_URL origin',
    });
  });
});

describe('validateSlackEventCaptureCanaryUrl', () => {
  it('allows explicitly confirmed HTTPS app origins and localhost HTTP development origins', () => {
    expect(
      validateSlackEventCaptureCanaryUrl(
        'https://timeline.example/app',
        'https://timeline.example',
      ),
    ).toMatchObject({
      ok: true,
      url: new URL('https://timeline.example/api/slack/events'),
    });
    expect(validateSlackEventCaptureCanaryUrl('http://localhost:3000', undefined)).toMatchObject({
      ok: true,
      url: new URL('http://localhost:3000/api/slack/events'),
    });
  });

  it('rejects missing, malformed, and unconfirmed non-local origins before signing payloads', () => {
    expect(validateSlackEventCaptureCanaryUrl(undefined, undefined)).toEqual({
      ok: false,
      reason: 'AUTH_URL missing',
    });
    expect(validateSlackEventCaptureCanaryUrl('not a url', 'https://timeline.example')).toEqual({
      ok: false,
      reason: 'AUTH_URL is not a valid URL',
    });
    expect(validateSlackEventCaptureCanaryUrl('http://timeline.example', undefined)).toEqual({
      ok: false,
      reason: 'AUTH_URL must be HTTPS, except localhost HTTP for development',
    });
    expect(validateSlackEventCaptureCanaryUrl('https://timeline.example', undefined)).toEqual({
      ok: false,
      reason: 'SLACK_CAPTURE_CANARY_ALLOWED_ORIGIN must match AUTH_URL origin',
    });
    expect(
      validateSlackEventCaptureCanaryUrl('https://timeline.example', 'https://other.example'),
    ).toEqual({
      ok: false,
      reason: 'SLACK_CAPTURE_CANARY_ALLOWED_ORIGIN does not match AUTH_URL origin',
    });
  });
});

describe('validateTelegramCaptureCanaryUrl', () => {
  it('allows explicitly confirmed HTTPS app origins and localhost HTTP development origins', () => {
    expect(
      validateTelegramCaptureCanaryUrl('https://timeline.example/app', 'https://timeline.example'),
    ).toMatchObject({
      ok: true,
      url: new URL('https://timeline.example/api/telegram/webhook'),
    });
    expect(validateTelegramCaptureCanaryUrl('http://localhost:3000', undefined)).toMatchObject({
      ok: true,
      url: new URL('http://localhost:3000/api/telegram/webhook'),
    });
  });

  it('rejects missing, malformed, and unconfirmed non-local origins before sending secrets', () => {
    expect(validateTelegramCaptureCanaryUrl(undefined, undefined)).toEqual({
      ok: false,
      reason: 'AUTH_URL missing',
    });
    expect(validateTelegramCaptureCanaryUrl('not a url', 'https://timeline.example')).toEqual({
      ok: false,
      reason: 'AUTH_URL is not a valid URL',
    });
    expect(validateTelegramCaptureCanaryUrl('http://timeline.example', undefined)).toEqual({
      ok: false,
      reason: 'AUTH_URL must be HTTPS, except localhost HTTP for development',
    });
    expect(validateTelegramCaptureCanaryUrl('https://timeline.example', undefined)).toEqual({
      ok: false,
      reason: 'TELEGRAM_CAPTURE_CANARY_ALLOWED_ORIGIN must match AUTH_URL origin',
    });
    expect(
      validateTelegramCaptureCanaryUrl('https://timeline.example', 'https://other.example'),
    ).toEqual({
      ok: false,
      reason: 'TELEGRAM_CAPTURE_CANARY_ALLOWED_ORIGIN does not match AUTH_URL origin',
    });
  });
});
