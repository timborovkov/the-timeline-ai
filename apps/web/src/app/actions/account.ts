'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { AuthError } from 'next-auth';

import { getRequestIdentity, hasGitHubAuth, signIn } from '@/lib/auth';
import { ACCOUNT_SETTINGS_PATH } from '@/lib/auth-redirect';
import {
  createGitHubLinkCookie,
  GITHUB_LINK_FAILED,
  GITHUB_LINK_RETURN,
} from '@/lib/github-login-link';
import { isLegalPublicationReady } from '@/lib/legal-publication';
import { runSentryServerAction } from '@/lib/sentry-action';

export async function linkGitHubAction(): Promise<void> {
  return runSentryServerAction('link_github_oauth', async () => {
    const { session, impersonation } = await getRequestIdentity();
    if (!session?.user.id)
      redirect(`/sign-in?callbackUrl=${encodeURIComponent(ACCOUNT_SETTINGS_PATH)}`);
    if (impersonation || !hasGitHubAuth || !isLegalPublicationReady()) redirect(GITHUB_LINK_FAILED);

    let destination: URL;
    try {
      const location: unknown = await signIn('github', {
        redirect: false,
        redirectTo: GITHUB_LINK_RETURN,
      });
      if (typeof location !== 'string') redirect(GITHUB_LINK_FAILED);
      destination = new URL(location);
    } catch (error) {
      if (error instanceof AuthError) redirect(GITHUB_LINK_FAILED);
      throw error;
    }
    const intent = await createGitHubLinkCookie(destination, session.user.id, await headers());
    if (!intent) redirect(GITHUB_LINK_FAILED);

    (await cookies()).set(intent);
    redirect(destination.href);
  });
}
