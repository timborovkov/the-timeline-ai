import { PUBLIC_ANALYTICS_SURFACES, type PublicSurface } from '@timeline/shared/analytics';

import type { CaptureResult, PostHog } from 'posthog-js';

import { expireFirstPartyCookie, readPublicAnalyticsConsent } from '@/lib/public-analytics-consent';
import { classifyPublicAnalyticsPath } from '@/lib/public-analytics-routes';

const PUBLIC_POSTHOG_PERSISTENCE_NAME = 'timeline_public_analytics_v1';
export const PUBLIC_POSTHOG_PERSISTENCE_KEY = `ph_${PUBLIC_POSTHOG_PERSISTENCE_NAME}`;
export const PUBLIC_POSTHOG_CONSENT_KEY = 'tl_posthog_consent_v1';

const PUBLIC_ANALYTICS_CTA_VALUES = [
  'try_project',
  'sign_in',
  'open_dashboard',
  'contact_support',
  'view_integrations',
  'view_how_it_works',
] as const;

export type PublicAnalyticsCta = (typeof PUBLIC_ANALYTICS_CTA_VALUES)[number];

const PUBLIC_EVENT_NAMES = ['public_page_viewed', 'public_cta_clicked'] as const;
const LEGACY_CONVEX_STORAGE_KEYS = ['am_vid', 'am_sid', 'am_st'] as const;
const REQUIRED_POSTHOG_PROPERTIES = [
  'token',
  'distinct_id',
  '$device_id',
  '$session_id',
  '$window_id',
  '$lib',
  '$lib_version',
] as const;

const configuredKey = normalizePublicValue(process.env.NEXT_PUBLIC_POSTHOG_KEY);
const configuredHost = normalizePostHogHost(process.env.NEXT_PUBLIC_POSTHOG_HOST);

export const isPublicBrowserAnalyticsConfigured = Boolean(configuredKey && configuredHost);

let activeSurface: PublicSurface | undefined;
let initializedClient: PostHog | undefined;
let loadingClient: Promise<PostHog | undefined> | undefined;
let providerCapturingActive = false;

export async function capturePublicPageView(surface: PublicSurface): Promise<void> {
  if (!activatePublicBrowserAnalytics(surface)) return;
  const client = await getPublicPostHogClient();
  if (activeSurface !== surface || !canCaptureCurrentPublicSurface(surface) || !client) return;
  try {
    client.capture(
      'public_page_viewed',
      { surface, $geoip_disable: true, $process_person_profile: false },
      { send_instantly: true },
    );
  } catch {
    // Analytics must never block public navigation or interaction.
  }
}

export function activatePublicBrowserAnalytics(surface: PublicSurface): boolean {
  if (!canCaptureCurrentPublicSurface(surface)) return false;
  activeSurface = surface;
  return true;
}

export async function capturePublicCta(
  surface: PublicSurface,
  cta: PublicAnalyticsCta,
): Promise<void> {
  if (
    activeSurface !== surface ||
    !canCaptureCurrentPublicSurface(surface) ||
    !isPublicAnalyticsCta(cta)
  ) {
    return;
  }
  const client = await getPublicPostHogClient();
  if (activeSurface !== surface || !canCaptureCurrentPublicSurface(surface) || !client) return;
  try {
    client.capture(
      'public_cta_clicked',
      { cta, surface, $geoip_disable: true, $process_person_profile: false },
      { send_instantly: true },
    );
  } catch {
    // Analytics must never block public navigation or interaction.
  }
}

export function pausePublicBrowserAnalytics(): void {
  activeSurface = undefined;
}

export function deactivatePublicBrowserAnalytics(): void {
  activeSurface = undefined;
  providerCapturingActive = false;
  if (initializedClient) {
    try {
      initializedClient.set_config({ disable_persistence: true });
    } catch {
      // Explicit storage cleanup below remains authoritative.
    }
    try {
      initializedClient.opt_out_capturing();
    } catch {
      // Explicit storage cleanup below remains authoritative.
    }
    try {
      initializedClient.reset(true);
    } catch {
      // Explicit storage cleanup below remains authoritative.
    }
    try {
      initializedClient.set_config({ disable_persistence: true });
    } catch {
      // Explicit storage cleanup below remains authoritative.
    }
  }
  clearPublicPostHogStorage();
}

export function withdrawPublicBrowserAnalytics(): void {
  deactivatePublicBrowserAnalytics();
}

export function clearLegacyPublicTrackerStorage(): void {
  clearFirstPartyStorageKeys(LEGACY_CONVEX_STORAGE_KEYS);
}

export function sanitizePublicPostHogEvent(result: CaptureResult | null): CaptureResult | null {
  if (
    !result ||
    !PUBLIC_EVENT_NAMES.includes(result.event as (typeof PUBLIC_EVENT_NAMES)[number])
  ) {
    return null;
  }

  const surface: unknown = result.properties.surface;
  if (!isPublicSurface(surface)) return null;

  const properties: CaptureResult['properties'] = {
    surface,
    $geoip_disable: true,
    $process_person_profile: false,
  };
  for (const property of REQUIRED_POSTHOG_PROPERTIES) {
    const value: unknown = result.properties[property];
    if (typeof value === 'string' && value.length > 0 && value.length <= 200) {
      properties[property] = value;
    }
  }

  if (result.event === 'public_cta_clicked') {
    const cta: unknown = result.properties.cta;
    if (!isPublicAnalyticsCta(cta)) return null;
    properties.cta = cta;
  }

  if (typeof properties.distinct_id !== 'string' || typeof properties.token !== 'string') {
    return null;
  }

  return { ...result, $set: undefined, $set_once: undefined, $unset: undefined, properties };
}

export function isPublicAnalyticsCta(value: unknown): value is PublicAnalyticsCta {
  return (
    typeof value === 'string' && PUBLIC_ANALYTICS_CTA_VALUES.includes(value as PublicAnalyticsCta)
  );
}

function isPublicSurface(value: unknown): value is PublicSurface {
  return typeof value === 'string' && PUBLIC_ANALYTICS_SURFACES.includes(value as PublicSurface);
}

async function getPublicPostHogClient(): Promise<PostHog | undefined> {
  if (
    !configuredKey ||
    !configuredHost ||
    !activeSurface ||
    !canCaptureCurrentPublicSurface(activeSurface)
  ) {
    return undefined;
  }
  if (initializedClient) {
    return resumePublicPostHogClient(initializedClient) ? initializedClient : undefined;
  }
  if (loadingClient) return loadingClient;

  loadingClient = import('posthog-js')
    .then(({ default: posthog }) => {
      if (!activeSurface || !canCaptureCurrentPublicSurface(activeSurface)) return undefined;
      initializedClient = posthog.init(configuredKey, {
        api_host: configuredHost,
        advanced_disable_flags: true,
        autocapture: false,
        before_send: sanitizePublicPostHogEvent,
        capture_dead_clicks: false,
        capture_exceptions: false,
        capture_heatmaps: false,
        capture_pageleave: false,
        capture_pageview: false,
        capture_performance: false,
        consent_persistence_name: PUBLIC_POSTHOG_CONSENT_KEY,
        cross_subdomain_cookie: false,
        defaults: '2026-05-30',
        disable_conversations: true,
        disable_external_dependency_loading: true,
        disable_product_tours: true,
        disable_scroll_properties: true,
        disable_session_recording: true,
        disable_surveys: true,
        disable_surveys_automatic_display: true,
        disable_web_experiments: true,
        opt_in_site_apps: false,
        opt_out_capturing_by_default: true,
        persistence: 'localStorage',
        persistence_name: PUBLIC_POSTHOG_PERSISTENCE_NAME,
        person_profiles: 'never',
        rageclick: false,
        request_batching: false,
        respect_dnt: true,
        save_campaign_params: false,
        save_referrer: false,
        split_storage: false,
      });
      return resumePublicPostHogClient(initializedClient) ? initializedClient : undefined;
    })
    .catch(() => {
      providerCapturingActive = false;
      clearPublicPostHogStorage();
      return undefined;
    })
    .finally(() => {
      loadingClient = undefined;
    });
  return loadingClient;
}

function canCaptureCurrentPublicSurface(surface: unknown): surface is PublicSurface {
  return (
    isPublicSurface(surface) &&
    readPublicAnalyticsConsent()?.choice === 'accepted' &&
    typeof window !== 'undefined' &&
    classifyPublicAnalyticsPath(window.location.pathname) === surface
  );
}

function resumePublicPostHogClient(client: PostHog): boolean {
  try {
    client.set_config({ disable_persistence: false });
    if (!providerCapturingActive || client.has_opted_out_capturing()) {
      client.opt_in_capturing({ captureEventName: false });
    }
    providerCapturingActive = true;
    return true;
  } catch {
    providerCapturingActive = false;
    clearPublicPostHogStorage();
    return false;
  }
}

function clearPublicPostHogStorage(): void {
  if (typeof window === 'undefined') return;

  const keys = [
    PUBLIC_POSTHOG_PERSISTENCE_KEY,
    `${PUBLIC_POSTHOG_PERSISTENCE_KEY}__flags`,
    `${PUBLIC_POSTHOG_PERSISTENCE_KEY}__surveys`,
    `${PUBLIC_POSTHOG_PERSISTENCE_KEY}_window_id`,
    `${PUBLIC_POSTHOG_PERSISTENCE_KEY}_primary_window_exists`,
    PUBLIC_POSTHOG_CONSENT_KEY,
  ];
  const legacyKey = legacyPostHogPersistenceKey(configuredKey);
  if (legacyKey) {
    keys.push(
      legacyKey,
      `${legacyKey}__flags`,
      `${legacyKey}__surveys`,
      `${legacyKey}_window_id`,
      `${legacyKey}_primary_window_exists`,
    );
  }

  clearFirstPartyStorageKeys(keys);
  clearLegacyPublicTrackerStorage();
  if (configuredKey) {
    const legacyConsentKey = `__ph_opt_in_out_${configuredKey}`;
    clearFirstPartyStorageKeys([legacyConsentKey]);
  }
}

function clearFirstPartyStorageKeys(keys: readonly string[]): void {
  if (typeof window === 'undefined') return;
  for (const key of keys) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Continue clearing every available storage backend.
    }
    try {
      window.sessionStorage.removeItem(key);
    } catch {
      // Continue clearing every available storage backend.
    }
    try {
      expireFirstPartyCookie(key);
    } catch {
      // Continue clearing every available storage backend.
    }
  }
}

function legacyPostHogPersistenceKey(key: string | undefined): string | undefined {
  if (!key) return undefined;
  return `ph_${key.replace(/\+/g, 'PL').replace(/\//g, 'SL').replace(/=/g, 'EQ')}_posthog`;
}

function normalizePublicValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized !== 'undefined' ? normalized : undefined;
}

function normalizePostHogHost(value: string | undefined): string | undefined {
  const normalized = normalizePublicValue(value) ?? 'https://eu.i.posthog.com';
  try {
    const url = new URL(normalized);
    return url.protocol === 'https:' && url.origin === 'https://eu.i.posthog.com'
      ? url.origin
      : undefined;
  } catch {
    return undefined;
  }
}
