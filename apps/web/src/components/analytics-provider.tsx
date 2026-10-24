'use client';

import { usePathname } from 'next/navigation';
import posthog from 'posthog-js';
import { PostHogProvider } from 'posthog-js/react';
import { useEffect, useRef, type ReactNode } from 'react';

import { sanitizeBrowserAnalyticsEvent } from '@/lib/browser-analytics';

const key =
  process.env.NEXT_PUBLIC_POSTHOG_KEY && process.env.NEXT_PUBLIC_POSTHOG_KEY !== 'undefined'
    ? process.env.NEXT_PUBLIC_POSTHOG_KEY
    : undefined;
const configuredHost = process.env.NEXT_PUBLIC_POSTHOG_HOST;
const host =
  configuredHost === undefined || configuredHost.length === 0
    ? 'https://eu.i.posthog.com'
    : configuredHost;
const isConfigured = Boolean(key);
let initialized = false;
let publicPagePaths: ReadonlySet<string> = new Set();

function ensurePostHogInitialized(): boolean {
  if (!key) return false;
  if (initialized) return true;
  posthog.init(key, {
    api_host: host,
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    disable_session_recording: true,
    save_campaign_params: false,
    before_send: (event) => sanitizeBrowserAnalyticsEvent(event, publicPagePaths),
    person_profiles: 'identified_only',
    persistence: 'localStorage+cookie',
  });
  initialized = true;
  return true;
}

export function WebsiteAnalytics({ paths }: { paths: readonly string[] }) {
  const pathname = usePathname();
  const lastPage = useRef<string | null>(null);

  useEffect(() => {
    publicPagePaths = new Set(paths);
    if (!pathname || lastPage.current === pathname) return;
    // Remember private routes too, so public → app → public counts a return visit.
    lastPage.current = pathname;
    if (!publicPagePaths.has(pathname) || !ensurePostHogInitialized()) return;
    posthog.capture('$pageview', {
      $current_url: window.location.origin + pathname,
      $pathname: pathname,
      $referrer: document.referrer || '$direct',
    });
  }, [pathname, paths]);

  return null;
}

export function AnalyticsProvider({
  children,
  userId,
  teamId,
}: {
  children: ReactNode;
  userId: string;
  teamId: string;
}) {
  useEffect(() => {
    if (!ensurePostHogInitialized()) return;
    posthog.identify(userId);
    posthog.group('team', teamId);
  }, [teamId, userId]);

  if (!isConfigured) return children;
  return <PostHogProvider client={posthog}>{children}</PostHogProvider>;
}
