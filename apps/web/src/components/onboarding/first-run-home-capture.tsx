'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { CaptureStartedTime } from '@/components/onboarding/processing-screen';

export function FirstRunHomeCapture({
  ready,
  failed,
  emailWaiting,
  startedAt,
  completed,
  total,
  href,
}: {
  ready: boolean;
  failed: boolean;
  emailWaiting: boolean;
  startedAt: Date | null;
  completed: number;
  total: number;
  href: string;
}) {
  const router = useRouter();
  useEffect(() => {
    if (ready || failed) return;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, 2500);
    return () => {
      clearInterval(id);
    };
  }, [ready, failed, router]);

  const title = ready
    ? 'Your first record is ready'
    : failed
      ? 'Your first capture needs attention'
      : emailWaiting
        ? 'Waiting for your email'
        : 'Your first capture is processing';

  return (
    <div className="rounded-md border border-border bg-surface p-4">
      <p className="text-sm font-medium">{title}</p>
      {startedAt ? <CaptureStartedTime waiting={emailWaiting} value={startedAt} /> : null}
      {!ready && total > 0 ? (
        <p className="mt-1 text-xs text-fg-muted">
          {completed} of {total} steps complete
        </p>
      ) : null}
      <p className="mt-3">
        <Link href={href} className="text-sm font-medium text-fg underline underline-offset-2">
          {ready ? 'Open your first record' : 'View capture status'}
        </Link>
      </p>
    </div>
  );
}
