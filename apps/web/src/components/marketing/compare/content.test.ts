import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import {
  COMPARE_HUB,
  COMPARE_PAGES,
  COMPARE_SLUGS,
  LEGACY_COMPARE_REDIRECTS,
  findComparePage,
  findComparePageByRoute,
  isLegacyCompareSlug,
} from '@/components/marketing/compare/content';
import { COMPARE_NAV_ITEMS } from '@/components/marketing/copy';

describe('compare content', () => {
  it('publishes a hub, four cited head-to-head pages, and legacy works-with redirects', () => {
    expect(COMPARE_HUB.route).toBe('/compare');
    expect(COMPARE_PAGES).toHaveLength(4);
    expect(COMPARE_PAGES.map((page) => page.slug)).toEqual([...COMPARE_SLUGS]);
    expect(COMPARE_NAV_ITEMS.map((item) => item.href)).toEqual(
      COMPARE_PAGES.map((page) => page.route),
    );

    expect(LEGACY_COMPARE_REDIRECTS).toEqual({
      hubspot: '/integrations/hubspot',
      jira: '/integrations/jira',
      linear: '/integrations/linear',
      notion: '/integrations/notion',
    });
    expect(isLegacyCompareSlug('hubspot')).toBe(true);
    expect(isLegacyCompareSlug('the-timeline-vs-day-ai')).toBe(false);

    for (const page of COMPARE_PAGES) {
      expect(findComparePage(page.slug)).toBe(page);
      expect(findComparePageByRoute(page.route)).toBe(page);
    }
  });

  it('targets competitor-alternatives queries on existing vs URLs without changing the H1', () => {
    expect(COMPARE_HUB.seoDescription.toLowerCase()).toContain('alternatives');
    expect(COMPARE_HUB.summary.toLowerCase()).toContain('alternatives');
    expect(new Set(COMPARE_PAGES.map((page) => page.seoTitle)).size).toBe(COMPARE_PAGES.length);

    for (const page of COMPARE_PAGES) {
      const alternative = `${page.name} alternative`;
      expect(page.title).toBe(`The Timeline vs ${page.name}`);
      expect(page.navLabel).toBe(`The Timeline vs ${page.name}`);
      expect(page.seoTitle).toBe(`${page.name} alternatives: The Timeline vs ${page.name}`);
      expect(page.seoDescription.toLowerCase()).toContain(`${alternative.toLowerCase()}s`);
      expect(page.summary.toLowerCase()).toContain(alternative.toLowerCase());
    }
  });

  it('cites every competitor fact to that competitor’s own site', () => {
    for (const page of COMPARE_PAGES) {
      expect(page.facts.length).toBeGreaterThan(0);
      expect(page.whenCompetitorBetter.toLowerCase()).toContain(
        `choose ${page.name.toLowerCase()}`,
      );
      expect(page.whenCompetitorBetter).toContain(
        page.competitorUrl.replace('https://www.', '').replace('https://', ''),
      );

      for (const fact of page.facts) {
        const sourceHost = new URL(fact.source.href).hostname.replace(/^www\./u, '');
        const competitorHost = new URL(page.competitorUrl).hostname.replace(/^www\./u, '');
        expect(fact.source.href.startsWith('https://')).toBe(true);
        expect(sourceHost).toBe(competitorHost);
      }
    }
  });
});
