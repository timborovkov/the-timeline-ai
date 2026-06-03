'use client';

import { useEffect } from 'react';

import { reportCaughtError } from '@/lib/sentry-report';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportCaughtError(error, {
      surface: 'render',
      operation: 'global_error_boundary',
      level: 'fatal',
      tags: { digest: error.digest },
    });
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial",
          background: 'hsl(40 14% 97%)',
          color: 'hsl(240 10% 8%)',
        }}
      >
        <div style={{ maxWidth: '28rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem' }}>
            The Timeline crashed
          </h1>
          <p style={{ fontSize: '0.875rem', opacity: 0.7, marginBottom: '1rem' }}>
            An unexpected error broke the page. Reload to try again.
          </p>
          {error.digest ? (
            <p
              style={{
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: '0.75rem',
                opacity: 0.5,
                marginBottom: '1.5rem',
              }}
            >
              ref: {error.digest}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => {
              reset();
            }}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '0.5rem',
              border: '1px solid hsl(240 6% 89%)',
              background: 'white',
              fontSize: '0.875rem',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
