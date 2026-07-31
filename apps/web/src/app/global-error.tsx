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
            background: #f7f6f2;
            color: #20211e;
            padding: 1rem;
            font-family: Switzer, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          }
          .global-error-panel {
            width: min(100%, 32rem);
            border: 1px solid #d7d5cd;
            background: #fcfbf8;
            padding: 1.5rem;
          }
          .global-error-title {
            font-size: 1.5rem;
            font-weight: 600;
            line-height: 1.35;
            margin: 0 0 0.75rem;
          }
          .global-error-copy {
            font-size: 0.875rem;
            line-height: 1.55;
            color: #62635e;
            margin: 0;
          }
          .global-error-details {
            color: #62635e;
            font-size: 0.75rem;
            line-height: 1.55;
            margin: 1rem 0 0;
          }
          .global-error-ref {
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
            overflow-wrap: anywhere;
          }
          .global-error-button {
            cursor: pointer;
            border-radius: 0.25rem;
            border: 1px solid #20211e;
            background: #c8ff55;
            color: inherit;
            margin-top: 1.5rem;
            min-height: 2.25rem;
            padding: 0.5rem 1rem;
            font: inherit;
            font-size: 0.875rem;
            font-weight: 600;
          }
          .global-error-button:hover {
            background: #b8ed49;
          }
          .global-error-button:focus-visible {
            outline: 2px solid #20211e;
            outline-offset: 3px;
          }
          @media (min-width: 640px) {
            .global-error-body { padding: 2rem; }
            .global-error-panel { padding: 2rem; }
          }
        `}</style>
        <div className="global-error-panel">
          <p role="status" aria-live="assertive" className="global-error-copy">
            The Timeline needs to recover
          </p>
          <h1 className="global-error-title">We couldn’t open this page</h1>
          <p className="global-error-copy">
            An unexpected error interrupted this page. Your saved workspace data has not been
            changed. Try again to reload it.
          </p>
          {error.digest ? (
            <details className="global-error-details">
              <summary>Technical details</summary>
              <p className="global-error-ref">Reference: {error.digest}</p>
            </details>
          ) : null}
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
