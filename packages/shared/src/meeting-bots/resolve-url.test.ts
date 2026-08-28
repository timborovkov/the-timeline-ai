import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetEnvForTests } from '#src/env.js';
import { isMeetingBotConfigured, resolveTranscriptWebhookUrl } from '#src/meeting-bots/index.js';

const ENV_BACKUP = { ...process.env };

beforeEach(() => {
  process.env.AUTH_SECRET = 'test-secret-test-secret';
  process.env.DATABASE_URL = 'postgres://x';
  resetEnvForTests();
});

afterEach(() => {
  process.env = { ...ENV_BACKUP };
  resetEnvForTests();
});

describe('resolveTranscriptWebhookUrl', () => {
  it('derives from AUTH_URL + fixed path when override is unset', () => {
    process.env.AUTH_URL = 'https://timeline.example.com';
    resetEnvForTests();
    expect(resolveTranscriptWebhookUrl()).toBe(
      'https://timeline.example.com/api/webhooks/recall/transcript',
    );
  });

  it('strips trailing slash on AUTH_URL so the join is clean', () => {
    process.env.AUTH_URL = 'https://timeline.example.com/';
    resetEnvForTests();
    expect(resolveTranscriptWebhookUrl()).toBe(
      'https://timeline.example.com/api/webhooks/recall/transcript',
    );
  });

  it('uses RECALL_TRANSCRIPT_WEBHOOK_URL verbatim when set (override path)', () => {
    process.env.AUTH_URL = 'https://timeline.example.com';
    process.env.RECALL_TRANSCRIPT_WEBHOOK_URL =
      'https://tunnel.ngrok.app/api/webhooks/recall/transcript';
    resetEnvForTests();
    expect(resolveTranscriptWebhookUrl()).toBe(
      'https://tunnel.ngrok.app/api/webhooks/recall/transcript',
    );
  });

  it('defaults to http://localhost:3000 in local dev when AUTH_URL is unset', () => {
    delete process.env.AUTH_URL;
    resetEnvForTests();
    expect(resolveTranscriptWebhookUrl()).toBe(
      'http://localhost:3000/api/webhooks/recall/transcript',
    );
  });
});

describe('isMeetingBotConfigured', () => {
  it('requires the workspace secret used by realtime transcript signatures', () => {
    process.env.RECALL_API_KEY = 'recall-test';
    process.env.RECALL_STATUS_WEBHOOK_SECRET = `whsec_${Buffer.from('legacy-status-only-for-tests').toString('base64')}`;
    delete process.env.RECALL_WORKSPACE_VERIFICATION_SECRET;
    resetEnvForTests();
    expect(isMeetingBotConfigured()).toBe(false);

    process.env.RECALL_WORKSPACE_VERIFICATION_SECRET = `whsec_${Buffer.from('workspace-secret-for-tests').toString('base64')}`;
    resetEnvForTests();
    expect(isMeetingBotConfigured()).toBe(true);
  });
});
