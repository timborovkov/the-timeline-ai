// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CookieSettingsButton, PublicAnalyticsBoundary } from '@/components/public-analytics';
import {
  clearPublicAnalyticsConsent,
  PUBLIC_ANALYTICS_CONSENT_COOKIE,
  readDocumentCookie,
  readPublicAnalyticsConsent,
  writePublicAnalyticsConsent,
} from '@/lib/public-analytics-consent';
import {
  clearPublicAttributionCookie,
  parsePublicAttributionCookie,
  PUBLIC_ATTRIBUTION_COOKIE,
} from '@/lib/public-attribution';

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

vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }));
vi.mock('@/lib/public-browser-analytics', () => ({
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
}));

beforeEach(() => {
  route.pathname = '/';
  vi.clearAllMocks();
  clearPublicAnalyticsConsent();
  clearPublicAttributionCookie();
  window.history.replaceState({}, '', '/');
});

afterEach(cleanup);

describe('PublicAnalyticsBoundary', () => {
  it('captures nothing before consent, then only the reviewed page and marked CTA', async () => {
    const user = userEvent.setup();
    window.history.replaceState(
      {},
      '',
      '/?utm_source=github&utm_medium=referral&utm_campaign=launch&gclid=ignored',
    );
    renderBoundary();

    expect(
      await screen.findByRole('heading', { name: 'Optional public analytics' }),
    ).not.toBeNull();
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
        document.cookie = `${PUBLIC_ANALYTICS_CONSENT_COOKIE}=0|accepted|${now}; Path=/`;
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
