// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CookieSettingsButton, PublicAnalyticsBoundary } from '@/components/public-analytics';
import {
  clearPublicAnalyticsConsent,
  readPublicAnalyticsConsent,
  writePublicAnalyticsConsent,
} from '@/lib/public-analytics-consent';
import {
  clearPublicAttributionCookie,
  storeFirstTouchPublicAttribution,
} from '@/lib/public-attribution';

const analytics = vi.hoisted(() => ({ clearLegacy: vi.fn(), withdraw: vi.fn() }));

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
vi.mock('@/lib/public-browser-analytics', () => ({
  activatePublicBrowserAnalytics: vi.fn(() => false),
  capturePublicCta: vi.fn(),
  capturePublicPageView: vi.fn(),
  clearLegacyPublicTrackerStorage: analytics.clearLegacy,
  deactivatePublicBrowserAnalytics: vi.fn(),
  isPublicAnalyticsCta: vi.fn(() => false),
  isPublicBrowserAnalyticsConfigured: false,
  pausePublicBrowserAnalytics: vi.fn(),
  withdrawPublicBrowserAnalytics: analytics.withdraw,
}));

beforeEach(() => {
  vi.clearAllMocks();
  clearPublicAnalyticsConsent();
  clearPublicAttributionCookie();
});

afterEach(cleanup);

describe('PublicAnalyticsBoundary without a public PostHog key', () => {
  it('does not offer or retain acceptance that could activate later', async () => {
    const user = userEvent.setup();
    writePublicAnalyticsConsent('accepted');
    storeFirstTouchPublicAttribution('?utm_source=github');

    render(
      <PublicAnalyticsBoundary>
        <CookieSettingsButton />
      </PublicAnalyticsBoundary>,
    );

    await waitFor(() => {
      expect(analytics.withdraw).toHaveBeenCalledOnce();
    });
    expect(analytics.clearLegacy).toHaveBeenCalledOnce();
    expect(readPublicAnalyticsConsent()).toBeUndefined();
    expect(screen.queryByRole('heading', { name: 'Optional public analytics' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Cookie settings' }));

    expect(
      screen.getByText('Optional public analytics is unavailable on this deployment.'),
    ).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Accept analytics' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reject analytics' })).toBeNull();
  });
});
