import * as Sentry from '@sentry/nextjs';

export async function runSentryServerAction<T>(
  operation: string,
  callback: () => Promise<T> | T,
): Promise<T> {
  return Sentry.withServerActionInstrumentation(
    operation,
    {
      headers: readRequestHeaders(),
    },
    callback,
  );
}

async function readRequestHeaders(): Promise<Headers> {
  try {
    const mod = await import('next/headers');
    if (typeof mod.headers !== 'function') return new Headers();
    return await mod.headers();
  } catch {
    return new Headers();
  }
}
