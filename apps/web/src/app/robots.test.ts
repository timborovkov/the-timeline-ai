import { afterEach, describe, expect, it } from 'vitest';

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
    for (const rule of rules) {
      const disallow = Array.isArray(rule.disallow) ? rule.disallow : [rule.disallow];
      expect(rule.allow).toBe('/');
      expect(disallow).toEqual(['/api/', '/app$', '/app/', '/accept-invite/', '/verify-email/']);
      expect(disallow).not.toContain('/help');
      expect(disallow).not.toContain('/help/contact');
      expect(disallow).not.toContain('/legal/accept');
      expect(disallow).not.toContain('/privacy');
      expect(disallow).not.toContain('/sign-in');
      expect(disallow).not.toContain('/sign-up');
      expect(disallow).not.toContain('/terms');
    }
  });
});
