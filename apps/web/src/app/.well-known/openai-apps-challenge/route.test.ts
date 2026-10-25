import { afterEach, describe, expect, it } from 'vitest';

import { GET } from '@/app/.well-known/openai-apps-challenge/route';

const ORIGINAL_TOKEN = process.env.OPENAI_APPS_CHALLENGE_TOKEN;

afterEach(() => {
  if (ORIGINAL_TOKEN === undefined) delete process.env.OPENAI_APPS_CHALLENGE_TOKEN;
  else process.env.OPENAI_APPS_CHALLENGE_TOKEN = ORIGINAL_TOKEN;
});

describe('OpenAI plugin domain challenge', () => {
  it('returns only the configured verification token', async () => {
    process.env.OPENAI_APPS_CHALLENGE_TOKEN = 'openai-domain-verification-token';

    const response = GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('openai-domain-verification-token');
  });

  it('does not expose a placeholder when no challenge is configured', () => {
    delete process.env.OPENAI_APPS_CHALLENGE_TOKEN;

    expect(GET().status).toBe(404);
  });
});
