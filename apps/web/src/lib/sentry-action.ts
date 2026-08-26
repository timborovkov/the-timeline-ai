import * as Sentry from '@sentry/nextjs';

const PRE_ACCEPTANCE_ACTIONS = new Set([
  'accept_legal',
  'resend_email_verification',
  'sign_in',
  'sign_in_with_git_hub',
  'sign_up',
  'submit_support_request',
]);

export async function runSentryServerAction<T>(
  operation: string,
  callback: () => Promise<T> | T,
): Promise<T> {
  const requestHeaders = readRequestHeaders();
  return Sentry.withServerActionInstrumentation(
    operation,
    {
      headers: requestHeaders,
    },
    async () => {
      if (!PRE_ACCEPTANCE_ACTIONS.has(operation)) {
        await requireCurrentLegalSession(requestHeaders);
      }
      return callback();
    },
  );
}

async function requireCurrentLegalSession(requestHeaders: Promise<Headers>): Promise<void> {
  // Unit tests invoke exported functions directly, outside the Next.js action
  // transport. Dedicated tests supply Next-Action and exercise this boundary.
  if (process.env.NODE_ENV === 'test' && !(await requestHeaders).has('next-action')) return;
  const [{ auth }, { hasCurrentLegalSession }, { redirect }] = await Promise.all([
    import('@/lib/auth'),
    import('@/lib/auth.config'),
    import('next/navigation'),
  ]);
  const session = await auth();
  // Individual actions remain responsible for authentication and authorization.
  // This shared boundary adds the current-document gate for authenticated users.
  if (!session?.user || hasCurrentLegalSession(session.user)) return;
  redirect('/legal/accept?returnTo=%2Fapp');
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
