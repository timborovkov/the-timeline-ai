import { describe, expect, it } from 'vitest';

import {
  buildPostmarkInboundCaptureCanaryPayload,
  formatLiveIntegrationCanaryReport,
  redactLiveIntegrationCanaryText,
  validatePostmarkInboundCaptureCanaryUrl,
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
          action: 'grant the Sentry token access to the configured project',
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
      '- Sentry API: grant the Sentry token access to the configured project; see docs/setup/sentry.html',
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
