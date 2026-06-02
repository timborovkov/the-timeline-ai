import { afterEach, describe, expect, it } from 'vitest';

import sitemap from '@/app/sitemap';
import { HELP_PAGES } from '@/lib/help-content';

const ENV_BACKUP = { ...process.env };

afterEach(() => {
  process.env = { ...ENV_BACKUP };
});

describe('sitemap', () => {
  it('lists every public marketing and help page with absolute URLs', () => {
    process.env.AUTH_URL = 'https://thetimeline.cc';
    delete process.env.VERCEL_URL;
    delete process.env.NEXTAUTH_URL;

    const urls = sitemap().map((entry) => entry.url);

    expect(urls).toEqual(
      expect.arrayContaining([
        'https://thetimeline.cc/',
        'https://thetimeline.cc/help',
        'https://thetimeline.cc/help/support',
        'https://thetimeline.cc/terms',
        'https://thetimeline.cc/privacy',
        ...HELP_PAGES.map((page) => `https://thetimeline.cc/help/${page.slug}`),
      ]),
    );
  });
});
