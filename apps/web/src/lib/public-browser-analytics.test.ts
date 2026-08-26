// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CaptureResult } from 'posthog-js';

import {
  readPublicAnalyticsConsent,
  writePublicAnalyticsConsent,
} from '@/lib/public-analytics-consent';

const posthog = vi.hoisted(() => {
  const client = {
    capture: vi.fn(),
    has_opted_out_capturing: vi.fn(() => false),
    opt_in_capturing: vi.fn(),
    opt_out_capturing: vi.fn(),
    reset: vi.fn(),
    set_config: vi.fn(),
  };
  return { client, init: vi.fn(() => client), moduleLoads: 0 };
});

vi.mock('posthog-js', () => {
  posthog.moduleLoads += 1;
  return { default: { init: posthog.init } };
});

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  posthog.moduleLoads = 0;
  posthog.client.has_opted_out_capturing.mockReturnValue(false);
  window.localStorage.clear();
  window.sessionStorage.clear();
  clearCookies();
  window.history.replaceState({}, '', '/');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('public PostHog runtime', () => {
  it('does not import or initialize PostHog without an operational public key', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', '');
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_HOST', 'https://eu.i.posthog.com');
    writePublicAnalyticsConsent('accepted');
    const analytics = await import('@/lib/public-browser-analytics');

    expect(analytics.isPublicBrowserAnalyticsConfigured).toBe(false);
    await analytics.capturePublicPageView('home');

    expect(posthog.init).not.toHaveBeenCalled();
    expect(posthog.moduleLoads).toBe(0);
    expect(posthog.client.capture).not.toHaveBeenCalled();
  });

  it('does not import or initialize PostHog without current affirmative consent', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'ph-test');
    const analytics = await import('@/lib/public-browser-analytics');

    await analytics.capturePublicPageView('home');
    writePublicAnalyticsConsent('rejected');
    await analytics.capturePublicPageView('home');

    expect(posthog.moduleLoads).toBe(0);
    expect(posthog.init).not.toHaveBeenCalled();
    expect(posthog.client.capture).not.toHaveBeenCalled();
  });

  it('does not import or initialize PostHog when the browser pathname is not the surface', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'ph-test');
    writePublicAnalyticsConsent('accepted');
    window.history.replaceState({}, '', '/app');
    const analytics = await import('@/lib/public-browser-analytics');

    await analytics.capturePublicPageView('home');

    expect(posthog.moduleLoads).toBe(0);
    expect(posthog.init).not.toHaveBeenCalled();
    expect(posthog.client.capture).not.toHaveBeenCalled();
  });

  it('initializes only the reviewed EU configuration and captures only manual events', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'ph-test');
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_HOST', 'https://eu.i.posthog.com');
    writePublicAnalyticsConsent('accepted');
    const analytics = await import('@/lib/public-browser-analytics');

    await analytics.capturePublicPageView('home');
    await analytics.capturePublicCta('home', 'try_project');

    expect(posthog.init).toHaveBeenCalledOnce();
    expect(posthog.moduleLoads).toBe(1);
    expect(posthog.init).toHaveBeenCalledWith(
      'ph-test',
      expect.objectContaining({
        api_host: 'https://eu.i.posthog.com',
        advanced_disable_flags: true,
        autocapture: false,
        capture_exceptions: false,
        capture_heatmaps: false,
        capture_pageleave: false,
        capture_pageview: false,
        capture_performance: false,
        consent_persistence_name: 'tl_posthog_consent_v1',
        disable_external_dependency_loading: true,
        disable_session_recording: true,
        disable_surveys: true,
        persistence: 'localStorage',
        persistence_name: 'timeline_public_analytics_v1',
        person_profiles: 'never',
        opt_out_capturing_by_default: true,
        save_campaign_params: false,
        save_referrer: false,
      }),
    );
    expect(posthog.client.opt_in_capturing).toHaveBeenCalledWith({ captureEventName: false });
    expect(posthog.client.capture).toHaveBeenNthCalledWith(
      1,
      'public_page_viewed',
      { surface: 'home', $geoip_disable: true, $process_person_profile: false },
      { send_instantly: true },
    );
    expect(posthog.client.capture).toHaveBeenNthCalledWith(
      2,
      'public_cta_clicked',
      {
        cta: 'try_project',
        surface: 'home',
        $geoip_disable: true,
        $process_person_profile: false,
      },
      { send_instantly: true },
    );
  });

  it('rebuilds the outbound payload from allowlisted properties', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'ph-test');
    const analytics = await import('@/lib/public-browser-analytics');
    const result = captureResult('public_cta_clicked', {
      surface: 'home',
      cta: 'try_project',
      token: 'ph-test',
      distinct_id: 'random-public-browser-id',
      $device_id: 'random-device-id',
      $current_url: 'https://example.com/?email=person@example.com',
      $referrer: 'https://private.example/secret',
      email: 'person@example.com',
      query: 'private search',
      arbitrary: 'not allowed',
    });

    expect(analytics.sanitizePublicPostHogEvent(result)).toEqual({
      ...result,
      $set: undefined,
      $set_once: undefined,
      $unset: undefined,
      properties: {
        surface: 'home',
        cta: 'try_project',
        token: 'ph-test',
        distinct_id: 'random-public-browser-id',
        $device_id: 'random-device-id',
        $geoip_disable: true,
        $process_person_profile: false,
      },
    });
    expect(
      analytics.sanitizePublicPostHogEvent(captureResult('$pageview', result.properties)),
    ).toBeNull();
    expect(
      analytics.sanitizePublicPostHogEvent(
        captureResult('public_page_viewed', { ...result.properties, surface: 'support' }),
      ),
    ).toBeNull();
    expect(
      analytics.sanitizePublicPostHogEvent(
        captureResult('public_cta_clicked', { ...result.properties, cta: 'anything' }),
      ),
    ).toBeNull();
  });

  it('keeps provider failures best-effort and still clears browser state', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'ph-test');
    writePublicAnalyticsConsent('accepted');
    const analytics = await import('@/lib/public-browser-analytics');
    posthog.client.capture.mockImplementationOnce(() => {
      throw new Error('capture unavailable');
    });

    await expect(analytics.capturePublicPageView('home')).resolves.toBeUndefined();

    window.localStorage.setItem(analytics.PUBLIC_POSTHOG_PERSISTENCE_KEY, 'value');
    posthog.client.opt_out_capturing.mockImplementationOnce(() => {
      throw new Error('opt out unavailable');
    });
    posthog.client.reset.mockImplementationOnce(() => {
      throw new Error('reset unavailable');
    });

    expect(() => {
      analytics.deactivatePublicBrowserAnalytics();
    }).not.toThrow();
    expect(window.localStorage.getItem(analytics.PUBLIC_POSTHOG_PERSISTENCE_KEY)).toBeNull();
  });

  it('keeps rejection and deactivation best-effort when local storage cleanup fails', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'ph-test');
    writePublicAnalyticsConsent('accepted');
    const analytics = await import('@/lib/public-browser-analytics');
    const removeItem = vi.spyOn(window.localStorage, 'removeItem').mockImplementation(() => {
      throw new DOMException('Storage is unavailable', 'SecurityError');
    });

    try {
      expect(() => {
        analytics.deactivatePublicBrowserAnalytics();
      }).not.toThrow();
      expect(() => {
        analytics.withdrawPublicBrowserAnalytics();
        writePublicAnalyticsConsent('rejected');
      }).not.toThrow();
      expect(readPublicAnalyticsConsent()?.choice).toBe('rejected');
    } finally {
      removeItem.mockRestore();
    }
  });

  it('clears provider and legacy state, then resumes an opted-out singleton without an opt-in event', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'ph-test');
    writePublicAnalyticsConsent('accepted');
    const analytics = await import('@/lib/public-browser-analytics');
    await analytics.capturePublicPageView('home');

    const keys = [
      analytics.PUBLIC_POSTHOG_PERSISTENCE_KEY,
      `${analytics.PUBLIC_POSTHOG_PERSISTENCE_KEY}__flags`,
      `${analytics.PUBLIC_POSTHOG_PERSISTENCE_KEY}__surveys`,
      `${analytics.PUBLIC_POSTHOG_PERSISTENCE_KEY}_window_id`,
      `${analytics.PUBLIC_POSTHOG_PERSISTENCE_KEY}_primary_window_exists`,
      analytics.PUBLIC_POSTHOG_CONSENT_KEY,
      'ph_ph-test_posthog',
      'ph_ph-test_posthog_window_id',
      'ph_ph-test_posthog_primary_window_exists',
      'am_vid',
      'am_sid',
      'am_st',
    ];
    for (const key of keys) {
      window.localStorage.setItem(key, 'value');
      window.sessionStorage.setItem(key, 'value');
      document.cookie = `${key}=value; Path=/`;
    }
    const legacyConsentKey = '__ph_opt_in_out_ph-test';
    window.localStorage.setItem(legacyConsentKey, '1');
    document.cookie = `${legacyConsentKey}=1; Path=/`;
    document.cookie = `tl_public_attribution=2|${Date.now()}|github||launch; Path=/`;

    analytics.deactivatePublicBrowserAnalytics();

    expect(posthog.client.opt_out_capturing).toHaveBeenCalledOnce();
    expect(posthog.client.set_config).toHaveBeenLastCalledWith({ disable_persistence: true });
    expect(posthog.client.reset).toHaveBeenCalledWith(true);
    for (const key of [...keys, legacyConsentKey]) {
      expect(window.localStorage.getItem(key)).toBeNull();
      expect(window.sessionStorage.getItem(key)).toBeNull();
      expect(document.cookie).not.toContain(`${key}=`);
    }
    expect(readPublicAnalyticsConsent()?.choice).toBe('accepted');
    expect(document.cookie).toMatch(/tl_public_attribution=2\|\d{13}\|github\|\|launch/u);

    posthog.client.has_opted_out_capturing.mockReturnValue(true);
    window.history.replaceState({}, '', '/privacy');
    await analytics.capturePublicPageView('privacy');

    expect(posthog.client.opt_in_capturing).toHaveBeenCalledTimes(2);
    expect(posthog.client.set_config).toHaveBeenLastCalledWith({ disable_persistence: false });
    expect(posthog.client.opt_in_capturing).toHaveBeenLastCalledWith({
      captureEventName: false,
    });
    expect(posthog.client.capture).toHaveBeenLastCalledWith(
      'public_page_viewed',
      { surface: 'privacy', $geoip_disable: true, $process_person_profile: false },
      { send_instantly: true },
    );
    expect(posthog.client.capture.mock.calls.flat()).not.toContain('$opt_in');
  });

  it('fails closed for an unreviewed ingestion host', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'ph-test');
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_HOST', 'https://us.i.posthog.com');
    writePublicAnalyticsConsent('accepted');
    const analytics = await import('@/lib/public-browser-analytics');

    expect(analytics.isPublicBrowserAnalyticsConfigured).toBe(false);
    await analytics.capturePublicPageView('home');

    expect(posthog.init).not.toHaveBeenCalled();
  });

  it('clears legacy Convex tracker state without a consent choice or PostHog key', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', '');
    const analytics = await import('@/lib/public-browser-analytics');
    for (const key of ['am_vid', 'am_sid', 'am_st']) {
      window.localStorage.setItem(key, 'value');
      window.sessionStorage.setItem(key, 'value');
      document.cookie = `${key}=value; Path=/`;
    }

    analytics.clearLegacyPublicTrackerStorage();

    for (const key of ['am_vid', 'am_sid', 'am_st']) {
      expect(window.localStorage.getItem(key)).toBeNull();
      expect(window.sessionStorage.getItem(key)).toBeNull();
      expect(document.cookie).not.toContain(`${key}=`);
    }
    expect(readPublicAnalyticsConsent()).toBeUndefined();
    expect(posthog.moduleLoads).toBe(0);
  });
});

function captureResult(event: string, properties: Record<string, unknown>): CaptureResult {
  return { event, properties } as CaptureResult;
}

function clearCookies(): void {
  for (const cookie of document.cookie.split(';')) {
    const name = cookie.split('=')[0]?.trim();
    if (name) document.cookie = `${name}=; Path=/; Max-Age=0`;
  }
}
