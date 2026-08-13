'use client';

import type { MouseEvent } from 'react';

function focusLandingMain(event: MouseEvent<HTMLAnchorElement>) {
  const targetId = event.currentTarget.hash.slice(1);
  document.getElementById(targetId)?.focus();
}

/**
 * Landing route shells make their main landmark programmatically focusable
 * for skip-link activation.
 */
export function LandingSkipLink() {
  return (
    <a
      href="#main"
      onClick={focusLandingMain}
      className="fixed left-3 top-3 sr-only rounded-sm border border-border-strong bg-surface p-3 text-sm text-fg focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[90] focus:p-3"
    >
      Skip to main content
    </a>
  );
}
