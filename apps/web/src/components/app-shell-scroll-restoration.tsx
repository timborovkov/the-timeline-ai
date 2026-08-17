'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

import { APP_MAIN_SCROLL_ID } from '@/lib/app-scroll';

const MAX_HASH_SCROLL_ATTEMPTS = 8;

function targetFromHash(): HTMLElement | null {
  const hash = window.location.hash.slice(1);
  if (!hash) return null;
  try {
    return document.getElementById(decodeURIComponent(hash));
  } catch {
    return document.getElementById(hash);
  }
}

export function AppMainScrollRestoration() {
  const pathname = usePathname();

  useEffect(() => {
    return scheduleMainScrollToRouteTarget();
  }, [pathname]);

  useEffect(() => {
    const originalPushState = window.history.pushState.bind(window.history);
    const originalReplaceState = window.history.replaceState.bind(window.history);
    let cancelScheduledScroll: (() => void) | null = null;
    let currentUrl = window.location.href;

    const scheduleScroll = () => {
      cancelScheduledScroll?.();
      cancelScheduledScroll = scheduleMainScrollToRouteTarget();
    };

    const scheduleScrollIfUrlChanged = () => {
      const nextUrl = window.location.href;
      if (nextUrl === currentUrl) return;
      currentUrl = nextUrl;
      scheduleScroll();
    };

    const syncUrlAndScheduleScroll = () => {
      currentUrl = window.location.href;
      scheduleScroll();
    };

    window.history.pushState = (...args) => {
      originalPushState(...args);
      scheduleScrollIfUrlChanged();
    };

    window.history.replaceState = (...args) => {
      originalReplaceState(...args);
      scheduleScrollIfUrlChanged();
    };

    window.addEventListener('popstate', syncUrlAndScheduleScroll);
    window.addEventListener('hashchange', syncUrlAndScheduleScroll);

    return () => {
      window.history.pushState = originalPushState;
      window.history.replaceState = originalReplaceState;
      window.removeEventListener('popstate', syncUrlAndScheduleScroll);
      window.removeEventListener('hashchange', syncUrlAndScheduleScroll);
      cancelScheduledScroll?.();
    };
  }, []);

  return null;
}

function scheduleMainScrollToRouteTarget(): () => void {
  let cancelled = false;
  let frame: number | null = null;
  let attempts = 0;

  const scheduleAttempt = () => {
    frame = window.requestAnimationFrame(runAttempt);
  };

  const runAttempt = () => {
    frame = null;
    if (cancelled) return;

    const main = document.getElementById(APP_MAIN_SCROLL_ID);
    const target = targetFromHash();
    if (!window.location.hash) {
      main?.scrollTo({ top: 0, left: 0 });
      return;
    }
    if (main && target === main) {
      main.scrollTo({ top: 0, left: 0 });
      return;
    }
    if (target) {
      target.scrollIntoView({ block: 'start' });
      return;
    }

    attempts += 1;
    if (attempts < MAX_HASH_SCROLL_ATTEMPTS) {
      scheduleAttempt();
      return;
    }

    main?.scrollTo({ top: 0, left: 0 });
  };

  scheduleAttempt();

  return () => {
    cancelled = true;
    if (frame !== null) {
      window.cancelAnimationFrame(frame);
    }
  };
}
