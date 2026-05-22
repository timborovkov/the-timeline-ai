'use client';

import { ErrorState } from '@/components/error-state';

export default function TelegramError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div>
      <header className="mb-10">
        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Telegram</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Telegram</h1>
      </header>
      <ErrorState
        title="Couldn't load Telegram links"
        description="The Telegram integration page failed to load."
        error={error}
        reset={reset}
      />
    </div>
  );
}
