import { expect } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';

import robots from '@/app/robots';
const ENV_BACKUP = { ...process.env };

afterEach(() => {
  process.env = { ...ENV_BACKUP };
});

describe('robots', () => {
  it('allows public content while protecting APIs, authenticated routes, and token routes', () => {
    process.env.AUTH_URL = 'https://thetimeline.cc/';

    const config = robots();
    const rules = Array.isArray(config.rules) ? config.rules : [config.rules];

    expect(config.sitemap).toBe('https://thetimeline.cc/sitemap.xml');
    const agents = rules.flatMap((rule) => rule.userAgent);
    expect(new Set(agents).size).toBe(agents.length);

    function ruleFor(agent: string) {
      return rules.find((rule) => [rule.userAgent].flat().includes(agent));
    }

    const privatePaths = ['/api/', '/app$', '/app/', '/accept-invite/', '/verify-email/'];
    const search = ruleFor('Googlebot');
    const retrieval = ruleFor('ChatGPT-User');
    const training = ruleFor('GPTBot');
    expect(search).not.toBe(retrieval);
    for (const agent of ['*', 'Googlebot', 'OAI-SearchBot', 'Claude-SearchBot', 'PerplexityBot']) {
      expect(ruleFor(agent)).toMatchObject({ allow: '/', disallow: privatePaths });
    }
    for (const agent of ['ChatGPT-User', 'Claude-User', 'Perplexity-User']) {
      expect(ruleFor(agent)).toBe(retrieval);
      expect(ruleFor(agent)).toMatchObject({ allow: '/', disallow: privatePaths });
    }
    for (const agent of ['GPTBot', 'ClaudeBot', 'Google-Extended', 'Applebot-Extended', 'CCBot']) {
      expect(ruleFor(agent)).toBe(training);
      expect(ruleFor(agent)?.disallow).toBe('/');
      expect(ruleFor(agent)?.allow).toBeUndefined();
    }
  });
});
