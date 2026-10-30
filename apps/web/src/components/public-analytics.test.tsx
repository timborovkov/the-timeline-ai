import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';
// Test environment: happy-dom

const route = vi.hoisted(() => ({ pathname: '/' }));
const analytics = vi.hoisted(() => ({
  activate: vi.fn(() => true),
  captureCta: vi.fn(() => Promise.resolve()),
  capturePageView: vi.fn(() => Promise.resolve()),
  clearLegacy: vi.fn(),
  deactivate: vi.fn(),
  pause: vi.fn(),
  withdraw: vi.fn(),
}));

await vi.mock(
  import.meta.resolve('next/navigation'),
  async () => ({
    ...(await import('next/navigation')),
    usePathname: () => route.pathname,
  }),
  () => import('next/navigation'),
);
await vi.mock(
  import.meta.resolve('@/lib/public-browser-analytics'),
  () => ({
    activatePublicBrowserAnalytics: analytics.activate,
    capturePublicCta: analytics.captureCta,
    capturePublicPageView: analytics.capturePageView,
    clearLegacyPublicTrackerStorage: analytics.clearLegacy,
    deactivatePublicBrowserAnalytics: analytics.deactivate,
    isPublicAnalyticsCta: (value: unknown) =>
      ['try_project', 'sign_in', 'open_dashboard'].includes(String(value)),
    isPublicBrowserAnalyticsConfigured: true,
    pausePublicBrowserAnalytics: analytics.pause,
    withdrawPublicBrowserAnalytics: analytics.withdraw,
  }),
  () => import('@/lib/public-browser-analytics'),
);

const { cleanup, render, screen, waitFor, within } = await import('@testing-library/react');
const { default: userEvent } = await import('@testing-library/user-event');
const { StrictMode } = await import('react');
const { CookieSettingsButton, PublicAnalyticsBoundary } =
  await import('@/components/public-analytics');
const {
  clearPublicAnalyticsConsent,
  PUBLIC_ANALYTICS_CONSENT_COOKIE,
  readDocumentCookie,
  readPublicAnalyticsConsent,
  writePublicAnalyticsConsent,
} = await import('@/lib/public-analytics-consent');
const { clearPublicAttributionCookie, parsePublicAttributionCookie, PUBLIC_ATTRIBUTION_COOKIE } =
  await import('@/lib/public-attribution');

beforeEach(() => {
  route.pathname = '/';
  vi.clearAllMocks();
  clearPublicAnalyticsConsent();
  clearPublicAttributionCookie();
  window.history.replaceState({}, '', '/');
});

afterEach(cleanup);

describe('PublicAnalyticsBoundary', () => {
  it('counts a consented public visit once through strict-mode effects and rerenders', async () => {
    writePublicAnalyticsConsent('accepted');
    const element = (
      <StrictMode>
        <PublicAnalyticsBoundary>
          <CookieSettingsButton />
        </PublicAnalyticsBoundary>
      </StrictMode>
    );
    const view = render(element);
    await waitFor(() => {
      expect(analytics.capturePageView).toHaveBeenCalledOnce();
    });
    view.rerender(element);
    expect(analytics.capturePageView).toHaveBeenCalledOnce();
    expect(analytics.capturePageView).toHaveBeenCalledWith('home');
  });

  it('captures nothing before consent, then only the reviewed page and marked CTA', async () => {
    const user = userEvent.setup();
    window.history.replaceState(
      {},
      '',
      '/?utm_source=github&utm_medium=referral&utm_campaign=launch&gclid=ignored',
    );
    renderBoundary();

    const bannerHeading = await screen.findByRole('heading', { name: 'Optional public analytics' });
    const banner = bannerHeading.closest('aside');
    expect(banner?.textContent).toContain('visits and selected actions on public pages');
    expect(banner?.textContent).not.toContain('PostHog');
    expect(screen.getByRole('button', { name: 'Reject' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Accept analytics' })).not.toBeNull();
    expect(analytics.capturePageView).not.toHaveBeenCalled();
    expect(analytics.captureCta).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Accept analytics' }));

    await waitFor(() => {
      expect(analytics.capturePageView).toHaveBeenCalledWith('home');
    });
    expect(readPublicAnalyticsConsent()?.choice).toBe('accepted');
    expect(parsePublicAttributionCookie(readDocumentCookie(PUBLIC_ATTRIBUTION_COOKIE))).toEqual({
      source: 'github',
      medium: 'referral',
      campaign: 'launch',
    });

    await user.click(screen.getByRole('button', { name: 'Try project' }));
    expect(analytics.captureCta).toHaveBeenCalledWith('home', 'try_project');

    await user.click(screen.getByRole('button', { name: 'Unmarked action' }));
    expect(analytics.captureCta).toHaveBeenCalledOnce();
  });

  it('opens Cookie settings from the banner and names PostHog as processor', async () => {
    const user = userEvent.setup();
    renderBoundary();

    const bannerHeading = await screen.findByRole('heading', { name: 'Optional public analytics' });
    const banner = bannerHeading.closest('aside');
    expect(banner).toBeInstanceOf(HTMLElement);
    expect(banner?.textContent).not.toContain('PostHog');
    if (!(banner instanceof HTMLElement)) return;

    await user.click(within(banner).getByRole('button', { name: 'Cookie settings' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('PostHog is the processor for optional public analytics');
    expect(dialog.textContent).toContain('measure visits and selected actions on public pages');
    expect(dialog.textContent).toContain('seven-year product-event retention');
    expect(dialog.textContent).toContain("Timeline's 90-day target");
    expect(dialog.textContent).toContain('cookies and similar technologies notice');
  });

  it('withdraws immediately and can later accept again', async () => {
    const user = userEvent.setup();
    renderBoundary();
    await user.click(await screen.findByRole('button', { name: 'Accept analytics' }));
    await waitFor(() => {
      expect(analytics.capturePageView).toHaveBeenCalledOnce();
    });

    await user.click(screen.getByRole('button', { name: 'Cookie settings' }));
    await user.click(screen.getByRole('button', { name: 'Reject analytics' }));

    expect(analytics.withdraw).toHaveBeenCalledOnce();
    expect(readPublicAnalyticsConsent()?.choice).toBe('rejected');
    expect(readDocumentCookie(PUBLIC_ATTRIBUTION_COOKIE)).toBeUndefined();

    await user.click(screen.getByRole('button', { name: 'Cookie settings' }));
    await user.click(screen.getByRole('button', { name: 'Accept analytics' }));

    await waitFor(() => {
      expect(analytics.capturePageView).toHaveBeenCalledTimes(2);
    });
    expect(readPublicAnalyticsConsent()?.choice).toBe('accepted');
  });

  it('fails closed on excluded and unknown routes', async () => {
    route.pathname = '/help/support';
    renderBoundary();

    await waitFor(() => {
      expect(analytics.deactivate).toHaveBeenCalled();
    });
    expect(screen.queryByRole('heading', { name: 'Optional public analytics' })).toBeNull();
    expect(analytics.capturePageView).not.toHaveBeenCalled();
    expect(analytics.captureCta).not.toHaveBeenCalled();
  });

  it.each(['missing', 'rejected', 'stale-version'] as const)(
    'clears provider and attribution state when consent is %s',
    async (consentState) => {
      const now = Date.now();
      if (consentState === 'rejected') {
        writePublicAnalyticsConsent('rejected', now);
      } else if (consentState === 'stale-version') {
        document.cookie = `${PUBLIC_ANALYTICS_CONSENT_COOKIE}=1|accepted|${now}; Path=/`;
      }
      document.cookie = `${PUBLIC_ATTRIBUTION_COOKIE}=2|${now}|github|referral|launch; Path=/`;

      renderBoundary();

      await waitFor(() => {
        expect(analytics.deactivate).toHaveBeenCalled();
      });
      expect(readDocumentCookie(PUBLIC_ATTRIBUTION_COOKIE)).toBeUndefined();
      expect(readPublicAnalyticsConsent()?.choice).toBe(
        consentState === 'rejected' ? 'rejected' : undefined,
      );
      expect(analytics.capturePageView).not.toHaveBeenCalled();
    },
  );

  it('preserves the public analytics lifecycle across reviewed public routes', async () => {
    const user = userEvent.setup();
    const view = renderBoundary();
    await user.click(await screen.findByRole('button', { name: 'Accept analytics' }));
    await waitFor(() => {
      expect(analytics.capturePageView).toHaveBeenCalledWith('home');
    });
    analytics.deactivate.mockClear();
    const consent = readPublicAnalyticsConsent();

    route.pathname = '/privacy';
    window.history.replaceState({}, '', '/privacy');
    view.rerender(
      <PublicAnalyticsBoundary>
        <CookieSettingsButton />
      </PublicAnalyticsBoundary>,
    );

    await waitFor(() => {
      expect(analytics.capturePageView).toHaveBeenCalledWith('privacy');
    });
    expect(analytics.deactivate).not.toHaveBeenCalled();
    expect(readPublicAnalyticsConsent()).toEqual(consent);
  });

  it('deactivates the public identity on private navigation and boundary unmount', async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, '', '/?utm_source=github');
    const view = renderBoundary();
    await user.click(await screen.findByRole('button', { name: 'Accept analytics' }));
    await waitFor(() => {
      expect(analytics.capturePageView).toHaveBeenCalledWith('home');
    });
    analytics.deactivate.mockClear();
    const attributionBeforeNavigation = readDocumentCookie(PUBLIC_ATTRIBUTION_COOKIE);

    route.pathname = '/app';
    view.rerender(
      <PublicAnalyticsBoundary>
        <CookieSettingsButton />
      </PublicAnalyticsBoundary>,
    );

    await waitFor(() => {
      expect(analytics.deactivate).toHaveBeenCalledOnce();
    });
    expect(readPublicAnalyticsConsent()?.choice).toBe('accepted');
    expect(readDocumentCookie(PUBLIC_ATTRIBUTION_COOKIE)).toBe(attributionBeforeNavigation);

    view.unmount();
    expect(analytics.deactivate).toHaveBeenCalledTimes(2);
    expect(readPublicAnalyticsConsent()?.choice).toBe('accepted');
    expect(readDocumentCookie(PUBLIC_ATTRIBUTION_COOKIE)).toBe(attributionBeforeNavigation);
  });
});

function renderBoundary() {
  return render(
    <PublicAnalyticsBoundary>
      <CookieSettingsButton />
      <button type="button" data-public-analytics-cta="try_project">
        Try project
      </button>
      <button type="button">Unmarked action</button>
    </PublicAnalyticsBoundary>,
  );
}
