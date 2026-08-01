'use client';

import { ErrorState } from '@/components/error-state';

interface HelpRouteErrorProps {
  description: string;
  error: Error & { digest?: string };
  title: string;
  variant: 'guide' | 'support';
  reset: () => void;
}

export function HelpRouteError({ description, error, title, variant, reset }: HelpRouteErrorProps) {
  const unchangedMessage =
    variant === 'guide'
      ? 'This error did not change the guide content. Check your connection, then try again.'
      : 'This error did not send or change any support request. Check your connection, then try again.';

  return (
    <article className="space-y-10">
      <header className="max-w-3xl space-y-4">
        <p className="text-xs font-medium text-fg-muted">
          {variant === 'guide' ? 'Guide' : 'Support'}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-fg">{title}</h1>
        <p className="text-lg text-fg-muted">{description}</p>
      </header>
      <ErrorState
        title={`Unable to load ${title}`}
        description={unchangedMessage}
        error={error}
        reset={reset}
      />
    </article>
  );
}
