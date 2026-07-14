'use client';

import { ErrorState } from '@/components/error-state';
import { PageHeader } from '@/components/page-header';

export function RouteError({
  title,
  error,
  reset,
}: {
  title: string;
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-6">
      <PageHeader title={title} />
      <ErrorState
        title={`Couldn’t load ${title.toLowerCase()}`}
        description="This page could not be loaded. Try the request again."
        error={error}
        reset={reset}
      />
    </div>
  );
}
