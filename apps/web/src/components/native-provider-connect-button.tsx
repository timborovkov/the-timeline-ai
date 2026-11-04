'use client';

import { useState } from 'react';

import { InlineError } from '@/components/inline-error';
import { notifyAction } from '@/lib/notify';
import { cn } from '@/lib/utils';
import { connectionErrorMessage } from '@/lib/ux-errors';

export function NativeProviderConnectButton({
  providerId,
  label,
  disabled = false,
  className,
}: {
  providerId: string;
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ message: string; details: string } | null>(null);
  const busyLabel = 'Opening sign-in…';

  async function startConnect() {
    setPending(true);
    setError(null);
    let details = '';
    try {
      const result = await notifyAction({
        id: `integration:connect:${providerId}`,
        loading: 'Opening sign-in…',
        success: 'Opening sign-in',
        error: 'Couldn’t start connection',
        run: async () => {
          const res = await fetch(`/api/integrations/${providerId}/start`, { method: 'POST' });
          if (!res.ok) {
            const text = await res.text();
            details = text;
            return { error: connectionErrorMessage(text, res.status) };
          }
          const data = (await res.json()) as { url?: string; error?: string };
          if (data.url) {
            window.location.href = data.url;
            return { ok: true };
          }
          details = data.error ?? 'unknown';
          return { error: connectionErrorMessage(data.error, res.status) };
        },
      });
      if (result.error) {
        setError({ message: result.error, details: details || result.error });
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-col items-end gap-1">
      <button
        type="button"
        aria-label={`${pending ? busyLabel : label}: ${providerId}`}
        aria-busy={pending || undefined}
        disabled={disabled || pending}
        onClick={() => void startConnect()}
        className={cn(
          'inline-flex min-h-8 items-center rounded-sm px-2 text-xs text-fg-muted hover:bg-surface-2 hover:text-fg focus-visible:ring-2 focus-visible:ring-signal/50 disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
      >
        {pending ? busyLabel : label}
      </button>
      {error ? (
        <InlineError
          message={error.message}
          details={error.details}
          onRetry={() => void startConnect()}
          retrying={pending}
        />
      ) : null}
    </div>
  );
}
