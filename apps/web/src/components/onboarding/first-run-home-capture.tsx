'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { pollFirstRun, type FirstRunStatusPayload } from '@/lib/first-run-poll';

export function FirstRunHomeCapture({
  failed,
  emailWaiting = false,
  initialStatus,
}: {
  failed: boolean;
  emailWaiting?: boolean;
  initialStatus?: FirstRunStatusPayload;
}) {
  const router = useRouter();
  const [polled, setPolled] = useState<{
    base: FirstRunStatusPayload;
    failed: boolean;
    terminal: boolean;
  } | null>(null);
  const current = polled?.base === initialStatus ? polled : null;
  const showFailure = failed || current?.failed === true;
  useEffect(() => {
    if (showFailure || !initialStatus) return;
    return pollFirstRun(initialStatus, {
      update: (status) => {
        const hasFailure =
          status.firstRun?.phase === 'failed' ||
          Boolean(status.record?.processingSteps.some((step) => step.status === 'failed'));
        if (hasFailure || status.firstRun?.phase !== 'processing') {
          setPolled({ base: initialStatus, failed: hasFailure, terminal: !hasFailure });
        }
      },
      navigate: (destination) => {
        if (destination === '/app')
          setPolled({ base: initialStatus, failed: false, terminal: true });
        else router.replace('/app/onboarding/record');
      },
      refresh: () => {
        router.refresh();
      },
    });
  }, [initialStatus, router, showFailure]);

  if (current?.terminal) return null;
  return (
    <div className="rounded-md border border-border bg-surface p-4">
      <p className="text-sm font-medium">
        {showFailure
          ? 'We could not finish that capture'
          : emailWaiting
            ? 'Waiting for your email'
            : 'Still reading what you brought'}
      </p>
      <p className="mt-1 text-sm leading-6 text-fg-muted">
        {showFailure
          ? 'Choose another document, email, or website. Nothing from that attempt became a lasting record.'
          : 'You can stay here. We will open the cited record as soon as it is ready.'}
      </p>
      <p className="mt-3">
        <Link
          href="/onboarding"
          className="text-sm font-medium text-fg underline-offset-2 hover:underline"
        >
          {showFailure ? 'Choose another way' : 'Back to setup'}
        </Link>
      </p>
    </div>
  );
}
