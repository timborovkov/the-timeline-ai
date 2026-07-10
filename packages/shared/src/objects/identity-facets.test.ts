import { describe, expect, it } from 'vitest';

import {
  normalizeIdentityFacet,
  validateIdentityFacetValue,
} from '#src/objects/identity-facets.js';

describe('identity facets', () => {
  it('normalizes provider identifiers consistently', () => {
    expect(normalizeIdentityFacet('email', ' Ada@Example.COM ')).toBe('ada@example.com');
    expect(normalizeIdentityFacet('phone', '+34 600-123-456')).toBe('+34600123456');
    expect(normalizeIdentityFacet('telegram', '@Ada')).toBe('ada');
  });

  it('rejects malformed typed identities', () => {
    expect(() => {
      validateIdentityFacetValue('email', 'not-email');
    }).toThrow('valid email');
    expect(() => {
      validateIdentityFacetValue('phone', '12');
    }).toThrow('valid phone');
    expect(() => {
      validateIdentityFacetValue('slack', 'U123');
    }).not.toThrow();
  });
});
