'use client';

import { AlertTriangle, LifeBuoy, RotateCw } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useSyncExternalStore } from 'react';

import { TechnicalDetails } from '@/components/technical-details';
import { Button } from '@/components/ui/button';
import { reportCaughtError } from '@/lib/sentry-report';
import { isStaleServerActionError, reloadForStaleServerAction } from '@/lib/stale-server-action';
import { supportRequestHref } from '@/lib/support-context';

interface Props {
  title?: string;
  description?: string;
  error?: Error & { digest?: string };
  reset?: () => void;
  supportHref?: string;
}

const subscribeToPathname = () => () => undefined;

export function ErrorState({
  title = 'Something went wrong',
  description = 'An unexpected error occurred while loading this view.',
  error,
  reset,
  supportHref,
}: Props) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const pathname = useSyncExternalStore(
    subscribeToPathname,
    () => window.location.pathname,
    () => null,
  );
  const resolvedSupportHref = supportHref ?? supportRequestHref(pathname, error?.digest);
  const supportOpensEmail = resolvedSupportHref.startsWith('mailto:');

  const staleServerAction = Boolean(error && isStaleServerActionError(error));

  useEffect(() => {
    if (!error || staleServerAction) return;
    reportCaughtError(error, {
      surface: 'render',
      operation: title,
      tags: { digest: error.digest },
    });
    titleRef.current?.focus();
  }, [error, staleServerAction, title]);

  const resolvedDescription = staleServerAction
    ? 'Timeline was updated while this tab was open. Reload to pick up the latest app version, then try again.'
    : description;

  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-4 rounded-lg border border-danger/30 bg-bg px-6 py-12 text-center"
    >
      <span
        aria-hidden="true"
        className="grid size-9 place-items-center rounded-sm border border-danger/30 text-danger"
      >
        <AlertTriangle className="size-5" />
      </span>
      <div className="space-y-1">
        <h2 ref={titleRef} tabIndex={-1} className="text-base font-medium text-fg">
          {title}
        </h2>
        <p className="text-sm text-fg-muted">{resolvedDescription}</p>
        {error?.digest ? (
          <TechnicalDetails
            className="mt-3 text-left"
            items={[{ label: 'Error reference', value: error.digest, copyValue: error.digest }]}
          />
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {reset || staleServerAction ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              if (staleServerAction) {
                reloadForStaleServerAction();
                return;
              }
              reset?.();
            }}
            className="gap-2"
          >
            <RotateCw aria-hidden="true" className="size-3.5" />
            {staleServerAction ? 'Reload' : 'Retry'}
          </Button>
        ) : null}
        <Button asChild variant="outline" size="sm">
          {supportOpensEmail ? (
            <a href={resolvedSupportHref} className="gap-2">
              <LifeBuoy aria-hidden="true" className="size-3.5" />
              Get support
            </a>
          ) : (
            <Link href={resolvedSupportHref} target="_blank" rel="noreferrer" className="gap-2">
              <LifeBuoy aria-hidden="true" className="size-3.5" />
              Get support
            </Link>
          )}
        </Button>
      </div>
    </div>
  );
}
