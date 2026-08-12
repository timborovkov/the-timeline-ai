import { describe, expect, it } from 'vitest';

import {
  EDITORIAL_CANONICAL_ROUTES,
  EDITORIAL_CONTENT_TYPES,
  EDITORIAL_GUIDES,
  EDITORIAL_MACHINE_SUMMARIES,
  EDITORIAL_PUBLICATION_NAME,
  findEditorialGuide,
  GUIDE_ROUTES,
  NATIVE_EDITORIAL_PROVIDERS,
  RECORD_ROUTE,
} from '@/components/marketing/editorial/content';

describe('editorial content model', () => {
  it('exports stable canonical routes and machine-readable summaries', () => {
    expect(EDITORIAL_PUBLICATION_NAME).toBe('The Record');
    expect(EDITORIAL_CANONICAL_ROUTES).toEqual([
      RECORD_ROUTE,
      GUIDE_ROUTES.slackAndDrive,
      GUIDE_ROUTES.weeklyEngineeringUpdates,
      GUIDE_ROUTES.sentryReleaseIncidents,
    ]);
    expect(new Set(EDITORIAL_CANONICAL_ROUTES).size).toBe(4);
    expect(EDITORIAL_MACHINE_SUMMARIES).toHaveLength(4);
    expect(EDITORIAL_MACHINE_SUMMARIES.every((entry) => entry.summary.length > 80)).toBe(true);
  });

  it('defines all four publication forms and three substantial guides', () => {
    expect(EDITORIAL_CONTENT_TYPES.map((type) => type.id)).toEqual([
      'essay',
      'playbook',
      'dossier',
      'product-note',
    ]);
    expect(EDITORIAL_GUIDES).toHaveLength(3);

    for (const guide of EDITORIAL_GUIDES) {
      expect(findEditorialGuide(guide.slug)).toBe(guide);
      expect(guide.answer.checklist.length).toBeGreaterThanOrEqual(4);
      expect(guide.workflow.length).toBeGreaterThanOrEqual(5);
      expect(guide.diagram.sources.length).toBeGreaterThanOrEqual(3);
      expect(guide.boundaries.length).toBe(guide.nativeConnectors.length);
      expect(guide.limitations.length).toBeGreaterThanOrEqual(4);
      expect(guide.faqs.length).toBeGreaterThanOrEqual(3);
      expect(guide.relatedRoutes.length).toBeGreaterThan(0);
      expect(guide.cta.href).toBe('/sign-in');
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
      expect(guide.boundaries.map((boundary) => boundary.provider)).toEqual(guide.nativeConnectors);
    }
  });

  it('keeps edition labels independent from the provisional publication name', () => {
    expect(EDITORIAL_GUIDES.map((guide) => guide.issue)).toEqual([
      'Edition 001',
      'Edition 002',
      'Edition 003',
    ]);
  });
});
