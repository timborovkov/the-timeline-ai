'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

/** The return URL is a UI hint only. Only persisted subscription state confirms activation. */
export function BillingCheckoutStatus({ active, planName }: { active: boolean; planName: string }) {
  const router = useRouter();
  const [delayed, setDelayed] = useState(false);

  useEffect(() => {
    // Polar can append a customer session credential. Timeline does not use it.
    const url = new URL(window.location.href);
    if (url.searchParams.has('customer_session_token')) {
      url.searchParams.delete('customer_session_token');
      window.history.replaceState(
        window.history.state,
        '',
        `${url.pathname}${url.search}${url.hash}`,
      );
    }
  }, []);

  useEffect(() => {
    if (active) return;
    let attempts = 0;
    const interval = window.setInterval(() => {
      router.refresh();
      attempts += 1;
      if (attempts >= 10) {
        window.clearInterval(interval);
        setDelayed(true);
      }
    }, 3000);
    return () => {
      window.clearInterval(interval);
    };
  }, [active, router]);

  return (
    <div className="space-y-2 border border-border bg-surface-2 px-3 py-2" role="status">
      <p className="text-sm text-fg">
        {active
          ? `${planName} is active for this team.`
          : delayed
            ? 'Your plan change has not been confirmed yet.'
            : 'Back from checkout. Waiting for your plan to activate…'}
      </p>
      {!active ? (
        <>
          <p className="text-sm text-fg-muted">
            {delayed
              ? 'Please do not repeat checkout. Check again shortly; if this continues, contact support so we can check your payment and subscription.'
              : 'We’ll refresh automatically when Polar confirms your subscription. You do not need to check out again.'}
          </p>
          <button
            type="button"
            onClick={() => {
              router.refresh();
            }}
            className="min-h-11 text-sm font-medium text-fg underline underline-offset-4"
          >
            Check again
          </button>
        </>
      ) : null}
    </div>
  );
}
