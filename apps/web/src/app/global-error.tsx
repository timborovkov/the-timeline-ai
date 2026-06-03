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
      <body className="global-error-body">
        <style>{`
          .global-error-body {
            min-height: 100vh;
            margin: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            background: #f8f6f1;
            color: #1f1f1f;
            padding: 2rem;
            font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          }
          .global-error-panel {
            max-width: 28rem;
            text-align: center;
          }
          .global-error-title {
            font-size: 1.25rem;
            font-weight: 600;
            margin: 0 0 0.5rem;
          }
          .global-error-copy {
            font-size: 0.875rem;
            opacity: 0.7;
            margin: 0 0 1rem;
          }
          .global-error-ref {
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
            font-size: 0.75rem;
            opacity: 0.5;
            margin: 0 0 1.5rem;
          }
          .global-error-button {
            cursor: pointer;
            border-radius: 0.5rem;
            border: 1px solid rgba(31, 31, 31, 0.18);
            background: #ffffff;
            color: inherit;
            padding: 0.5rem 1rem;
            font: inherit;
            font-size: 0.875rem;
          }
        `}</style>
        <div className="global-error-panel">
          <h1 className="global-error-title">The Timeline crashed</h1>
          <p className="global-error-copy">
            An unexpected error broke the page. Reload to try again.
          </p>
          {error.digest ? <p className="global-error-ref">ref: {error.digest}</p> : null}
          <button
            type="button"
            onClick={() => {
              reset();
            }}
            className="global-error-button"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
