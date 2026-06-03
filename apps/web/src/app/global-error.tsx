'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="flex min-h-screen items-center justify-center bg-bg p-8 font-sans text-fg">
        <div className="max-w-md text-center">
          <h1 className="mb-2 text-xl font-semibold">The Timeline crashed</h1>
          <p className="mb-4 text-sm opacity-70">
            An unexpected error broke the page. Reload to try again.
          </p>
          {error.digest ? (
            <p className="mb-6 font-mono text-xs opacity-50">ref: {error.digest}</p>
          ) : null}
          <button
            type="button"
            onClick={() => {
              reset();
            }}
            className="cursor-pointer rounded-lg border border-border bg-white px-4 py-2 text-sm"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
