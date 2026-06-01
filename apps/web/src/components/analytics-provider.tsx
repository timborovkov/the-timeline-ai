'use client';

import posthog from 'posthog-js';
import { PostHogProvider } from 'posthog-js/react';
import { useEffect, type ReactNode } from 'react';

const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://eu.i.posthog.com';

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
    if (!key) return;
    posthog.init(key, {
      api_host: host,
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      disable_session_recording: true,
      person_profiles: 'identified_only',
      persistence: 'localStorage+cookie',
      loaded(client) {
        client.identify(userId);
        client.group('team', teamId);
      },
    });
  }, [teamId, userId]);

  if (!key) return children;
  return <PostHogProvider client={posthog}>{children}</PostHogProvider>;
}
