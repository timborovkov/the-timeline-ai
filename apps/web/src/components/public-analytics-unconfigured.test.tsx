import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';
// Test environment: happy-dom

const analytics = vi.hoisted(() => ({ clearLegacy: vi.fn(), withdraw: vi.fn() }));

await vi.mock(
  import.meta.resolve('next/navigation'),
  async () => ({
    ...(await import('next/navigation')),
    usePathname: () => '/',
  }),
  () => import('next/navigation'),
);
await vi.mock(
  import.meta.resolve('@/lib/public-browser-analytics'),
  () => ({
    activatePublicBrowserAnalytics: vi.fn(() => false),
    capturePublicCta: vi.fn(),
    capturePublicPageView: vi.fn(),
    clearLegacyPublicTrackerStorage: analytics.clearLegacy,
    deactivatePublicBrowserAnalytics: vi.fn(),
    isPublicAnalyticsCta: vi.fn(() => false),
    isPublicBrowserAnalyticsConfigured: false,
    pausePublicBrowserAnalytics: vi.fn(),
    withdrawPublicBrowserAnalytics: analytics.withdraw,
  }),
  () => import('@/lib/public-browser-analytics'),
);

const { cleanup, render, screen, waitFor } = await import('@testing-library/react');
const { default: userEvent } = await import('@testing-library/user-event');
const { CookieSettingsButton, PublicAnalyticsBoundary } =
  await import('@/components/public-analytics');
const { clearPublicAnalyticsConsent, readPublicAnalyticsConsent, writePublicAnalyticsConsent } =
  await import('@/lib/public-analytics-consent');
const { clearPublicAttributionCookie, storeFirstTouchPublicAttribution } =
  await import('@/lib/public-attribution');

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
