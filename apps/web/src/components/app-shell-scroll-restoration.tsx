'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

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
    const frame = scrollMainToRouteTarget();

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [pathname]);

  useEffect(() => {
    const originalPushState = window.history.pushState.bind(window.history);
    const originalReplaceState = window.history.replaceState.bind(window.history);
    let frame: number | null = null;
    let currentUrl = window.location.href;

    const scheduleScroll = () => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
      frame = scrollMainToRouteTarget();
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
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, []);

  return null;
}

function scrollMainToRouteTarget(): number {
  return window.requestAnimationFrame(() => {
    const target = targetFromHash();
    if (target) {
      target.scrollIntoView({ block: 'start' });
      return;
    }
    document.getElementById('main')?.scrollTo({ top: 0, left: 0 });
  });
}
