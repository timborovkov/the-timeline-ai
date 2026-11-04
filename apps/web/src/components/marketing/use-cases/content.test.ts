import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import { USE_CASE_NAV_ITEMS } from '@/components/marketing/copy';
import {
  findUseCase,
  findUseCaseByRoute,
  USE_CASE_CANONICAL_ROUTES,
  USE_CASE_HUB,
  USE_CASES,
} from '@/components/marketing/use-cases/content';

describe('use-case content', () => {
  it('publishes six distinct jobs plus a hub without inventing customers or weekly framing', () => {
    expect(USE_CASES).toHaveLength(6);
    expect(USE_CASE_CANONICAL_ROUTES).toEqual(USE_CASES.map((useCase) => useCase.route));
    expect(new Set(USE_CASES.map((useCase) => useCase.seoTitle)).size).toBe(6);
    expect(USE_CASE_HUB.route).toBe('/use-cases');

    const copy = JSON.stringify({ hub: USE_CASE_HUB, useCases: USE_CASES });
    expect(copy).not.toMatch(/WhatsApp|Slack Connect|Teams chat/iu);
    expect(copy).not.toMatch(/\bweekly\b/iu);
    expect(copy).not.toMatch(/testimonial|customer data|Northline/iu);

    for (const useCase of USE_CASES) {
      expect(findUseCase(useCase.slug)).toBe(useCase);
      expect(findUseCaseByRoute(useCase.route)).toBe(useCase);
      expect(useCase.faqs.length).toBeGreaterThanOrEqual(1);
      expect(useCase.screenshots.length).toBeGreaterThanOrEqual(1);
      expect(useCase.relatedRoutes.every((route) => route !== useCase.route)).toBe(true);
    }
  });

  it('keeps the public Use cases menu aligned with the six jobs and the product tour', () => {
    expect(USE_CASE_NAV_ITEMS.map((item) => item.href)).toEqual([
      ...USE_CASE_CANONICAL_ROUTES,
      '/product-tour',
    ]);
  });
});
