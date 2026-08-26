import { afterEach, describe, expect, it } from 'vitest';

import sitemap from '@/app/sitemap';
import { HELP_PAGES } from '@/lib/help-content';
import { createPublicDocumentRegistry, definePublicDocuments } from '@/lib/public-site';
import { buildPublicSitemap } from '@/lib/public-site/sitemap';

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

  it('uses reviewed source dates instead of request time', () => {
    process.env.AUTH_URL = 'https://thetimeline.cc';

    const first = sitemap();
    const second = sitemap();
    const byUrl = new Map(first.map((entry) => [entry.url, entry.lastModified]));

    expect(second).toEqual(first);
    expect(byUrl.get('https://thetimeline.cc/')).toBe('2026-08-21');
    expect(byUrl.get('https://thetimeline.cc/integrations')).toBe('2026-08-15');
    expect(byUrl.get('https://thetimeline.cc/help')).toBe('2026-08-26');
    expect(byUrl.get('https://thetimeline.cc/terms')).toBe('2026-06-03');
    expect(first.every((entry) => typeof entry.lastModified === 'string')).toBe(true);
  });

  it('returns serializer-safe canonical URLs for contributed routes', () => {
    const registry = createPublicDocumentRegistry(
      definePublicDocuments('sitemap-escaping', [
        {
          canonicalPath: '/guides/r&d/(notes)',
          kind: 'guide',
          title: 'R&D notes',
          description: 'Research and development notes.',
          indexability: 'index',
          dates: { modified: '2026-08-12', reviewed: '2026-08-12' },
          capability: { kind: 'current-product' },
          sitemap: { changeFrequency: 'monthly', priority: 0.5 },
          structuredData: [],
          llms: false,
        },
      ]),
    );

    expect(buildPublicSitemap(registry, 'https://thetimeline.cc')).toEqual([
      {
        url: 'https://thetimeline.cc/guides/r%26d/%28notes%29',
        lastModified: '2026-08-12',
        changeFrequency: 'monthly',
        priority: 0.5,
      },
    ]);
  });
});
