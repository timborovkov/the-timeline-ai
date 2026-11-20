import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import {
  onboardingCallbackForSource,
  orderChooserSources,
  parseOnboardingSourceIntent,
} from '@/lib/onboarding-source-intent';

describe('parseOnboardingSourceIntent', () => {
  it('accepts slack and telegram case-insensitively', () => {
    expect(parseOnboardingSourceIntent('slack')).toBe('slack');
    expect(parseOnboardingSourceIntent('Telegram')).toBe('telegram');
    expect(parseOnboardingSourceIntent(' SLACK ')).toBe('slack');
  });

  it('rejects unknown or empty values', () => {
    expect(parseOnboardingSourceIntent('email')).toBeNull();
    expect(parseOnboardingSourceIntent('discord')).toBeNull();
    expect(parseOnboardingSourceIntent('')).toBeNull();
    expect(parseOnboardingSourceIntent(null)).toBeNull();
    expect(parseOnboardingSourceIntent(undefined)).toBeNull();
  });
});

describe('orderChooserSources', () => {
  it('leads with preferred connector when it is available', () => {
    expect(
      orderChooserSources({
        connectors: ['slack', 'telegram'],
        preferred: 'telegram',
      }),
    ).toEqual(['telegram', 'slack', 'document', 'email', 'website']);
  });

  it('keeps Document/Email/Website when no connectors are available', () => {
    expect(orderChooserSources({ connectors: [], preferred: 'slack' })).toEqual([
      'document',
      'email',
      'website',
    ]);
  });

  it('lists available connectors before base sources without a preferred intent', () => {
    expect(orderChooserSources({ connectors: ['telegram', 'slack'] })).toEqual([
      'telegram',
      'slack',
      'document',
      'email',
      'website',
    ]);
  });

  it('ignores a preferred connector that is not available', () => {
    expect(
      orderChooserSources({
        connectors: ['telegram'],
        preferred: 'slack',
      }),
    ).toEqual(['telegram', 'document', 'email', 'website']);
  });
});

describe('onboardingCallbackForSource', () => {
  it('builds the onboarding continuation with source intent', () => {
    expect(onboardingCallbackForSource('slack')).toBe('/onboarding?source=slack');
    expect(onboardingCallbackForSource('telegram')).toBe('/onboarding?source=telegram');
  });
});
