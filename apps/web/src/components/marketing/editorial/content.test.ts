import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import {
  EDITORIAL_CANONICAL_ROUTES,
  EDITORIAL_GUIDES,
  EDITORIAL_MACHINE_SUMMARIES,
  EDITORIAL_PUBLICATION_NAME,
  findEditorialGuide,
  GUIDE_ROUTES,
  HOW_IT_WORKS_ROUTE,
  GUIDES_ROUTE,
  NATIVE_EDITORIAL_PROVIDERS,
} from '@/components/marketing/editorial/content';
describe('editorial content model', () => {
  it('exports stable canonical routes and machine-readable summaries', () => {
    expect(EDITORIAL_PUBLICATION_NAME).toBe('How Timeline works');
    expect(EDITORIAL_CANONICAL_ROUTES).toEqual([
      HOW_IT_WORKS_ROUTE,
      GUIDES_ROUTE,
      GUIDE_ROUTES.slackAndDrive,
      GUIDE_ROUTES.weeklyEngineeringUpdates,
      GUIDE_ROUTES.sentryReleaseIncidents,
      GUIDE_ROUTES.dailyUpdates,
      GUIDE_ROUTES.actionItems,
      GUIDE_ROUTES.projectHandover,
      GUIDE_ROUTES.slackSummaries,
    ]);
    expect(new Set(EDITORIAL_CANONICAL_ROUTES).size).toBe(9);
    expect(EDITORIAL_MACHINE_SUMMARIES).toHaveLength(9);
    expect(EDITORIAL_MACHINE_SUMMARIES.every((entry) => entry.summary.length > 80)).toBe(true);
  });

  it('publishes seven substantial walkthroughs', () => {
    expect(EDITORIAL_GUIDES).toHaveLength(7);

    for (const guide of EDITORIAL_GUIDES) {
      expect(findEditorialGuide(guide.slug)).toBe(guide);
      expect(guide.answer.checklist.length).toBeGreaterThanOrEqual(4);
      expect(guide.workflow.length).toBeGreaterThanOrEqual(5);
      expect(guide.diagram.sources.length).toBeGreaterThanOrEqual(3);
      expect(guide.boundaries.length).toBeGreaterThanOrEqual(guide.nativeConnectors.length);
      expect(guide.limitations.length).toBeGreaterThanOrEqual(4);
      expect(guide.faqs.length).toBeGreaterThanOrEqual(3);
      expect(guide.relatedRoutes.length).toBeGreaterThan(0);
      expect(guide.cta.href).toBe('/sign-up');
    }
  });

  it('keeps every claimed guide connector inside the native capability set', () => {
    expect(NATIVE_EDITORIAL_PROVIDERS).toEqual([
      'GitHub',
      'Linear',
      'Google Drive',
      'Monday.com',
      'Slack',
      'Sentry',
    ]);
    const nativeProviders = new Set(NATIVE_EDITORIAL_PROVIDERS);

    for (const guide of EDITORIAL_GUIDES) {
      for (const connector of guide.nativeConnectors) {
        expect(nativeProviders.has(connector)).toBe(true);
      }
      expect(
        guide.boundaries
          .filter((boundary) =>
            NATIVE_EDITORIAL_PROVIDERS.some((provider) => provider === boundary.provider),
          )
          .map((boundary) => boundary.provider),
      ).toEqual(guide.nativeConnectors);
    }
  });

  it('uses a plain-language name for the public explanation', () => {
    expect(EDITORIAL_PUBLICATION_NAME).toBe('How Timeline works');
  });

  it('keeps Drive guidance within captured-change coverage', () => {
    const guide = findEditorialGuide('search-slack-and-google-drive-together');
    const text = JSON.stringify(guide);
    expect(text).toContain('historical files are not enumerated');
    expect(text).toContain('baseline without writing an event');
    expect(text).toContain('CRM-relevant');
    expect(text).toContain('20 MB');
    expect(text).not.toContain('Supported file snapshots');
  });

  it('states native timing and branch boundaries in the affected guides', () => {
    const weeklyGuide = findEditorialGuide(
      'weekly-engineering-updates-from-slack-linear-and-github',
    );
    const incidentGuide = findEditorialGuide(
      'connect-sentry-incidents-to-releases-discussions-and-fixes',
    );

    expect(JSON.stringify(weeklyGuide)).toContain('default branch');
    expect(JSON.stringify(incidentGuide)).toContain('last-seen');
    expect(JSON.stringify(incidentGuide)).toContain('default branch');
  });
});
