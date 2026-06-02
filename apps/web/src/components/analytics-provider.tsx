'use client';

import posthog from 'posthog-js';
import { PostHogProvider } from 'posthog-js/react';
import { useEffect, type ReactNode } from 'react';

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

function ensurePostHogInitialized(): boolean {
  if (!key) return false;
  if (initialized) return true;
  posthog.init(key, {
    api_host: host,
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    disable_session_recording: true,
    person_profiles: 'identified_only',
    persistence: 'localStorage+cookie',
  });
  initialized = true;
  return true;
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
