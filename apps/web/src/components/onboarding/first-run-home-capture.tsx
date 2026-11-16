'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export function FirstRunHomeCapture({
  failed,
  emailWaiting = false,
}: {
  failed: boolean;
  emailWaiting?: boolean;
}) {
  const router = useRouter();
  useEffect(() => {
    if (failed) return;
    const id = setInterval(() => {
      router.refresh();
    }, 2500);
    return () => {
      clearInterval(id);
    };
  }, [failed, router]);

  return (
    <div className="rounded-md border border-border bg-surface p-4">
      <p className="text-sm font-medium">
        {failed
          ? 'We could not finish that capture'
          : emailWaiting
            ? 'Waiting for your email'
            : 'Still reading what you brought'}
      </p>
      <p className="mt-1 text-sm leading-6 text-fg-muted">
        {failed
          ? 'Choose another document, email, or website. Nothing from that attempt became a lasting record.'
          : 'You can stay here. We will open the cited record as soon as it is ready.'}
      </p>
      <p className="mt-3">
        <Link
          href="/onboarding"
          className="text-sm font-medium text-fg underline-offset-2 hover:underline"
        >
          {failed ? 'Choose another way' : 'Back to setup'}
        </Link>
      </p>
    </div>
  );
}
