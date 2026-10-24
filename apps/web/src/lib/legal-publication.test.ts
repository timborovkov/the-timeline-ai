import { describe, expect, it } from 'vitest';

import { isLegalPublicationReady } from '@/lib/legal-publication';

describe('isLegalPublicationReady', () => {
  it('fails closed in production unless readiness is explicitly attested', () => {
    expect(isLegalPublicationReady({ NODE_ENV: 'production' })).toBe(false);
    expect(
      isLegalPublicationReady({ NODE_ENV: 'production', LEGAL_PUBLICATION_READY: 'false' }),
    ).toBe(false);
    expect(
      isLegalPublicationReady({ NODE_ENV: 'production', LEGAL_PUBLICATION_READY: 'true' }),
    ).toBe(true);
  });

  it('keeps the legal flow available outside production', () => {
    expect(isLegalPublicationReady({ NODE_ENV: 'development' })).toBe(true);
    expect(isLegalPublicationReady({ NODE_ENV: 'test' })).toBe(true);
  });
});
