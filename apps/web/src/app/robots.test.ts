import { afterEach, describe, expect, it } from 'vitest';

import robots from '@/app/robots';

const ENV_BACKUP = { ...process.env };

afterEach(() => {
  process.env = { ...ENV_BACKUP };
});

describe('robots', () => {
  it('disallows APIs while leaving noindexed HTML routes crawlable', () => {
    process.env.AUTH_URL = 'https://thetimeline.cc/';

    const config = robots();
    const rules = Array.isArray(config.rules) ? config.rules : [config.rules];

    expect(config.sitemap).toBe('https://thetimeline.cc/sitemap.xml');
    for (const rule of rules) {
      const disallow = Array.isArray(rule.disallow) ? rule.disallow : [rule.disallow];
      expect(disallow).toEqual(['/api/']);
      expect(disallow).not.toContain('/sign-in');
      expect(disallow).not.toContain('/sign-up');
      expect(disallow).not.toContain('/accept-invite/');
      expect(disallow).not.toContain('/app/');
    }
  });
});
