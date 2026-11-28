import { accounts } from '@timeline/db';
import { and, eq } from 'drizzle-orm';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { linkGitHubAction } from '@/app/actions/account';
import { PageHeader } from '@/components/page-header';
import { SectionHeading } from '@/components/section-heading';
import { Button } from '@/components/ui/button';
import { getRequestIdentity, hasGitHubAuth } from '@/lib/auth';
import { ACCOUNT_SETTINGS_PATH } from '@/lib/auth-redirect';
import { db } from '@/lib/db';
import { getUserLegalAcceptance, hasCurrentLegalAcceptance } from '@/lib/legal';
import { isLegalPublicationReady } from '@/lib/legal-publication';

export const metadata = { title: 'Account settings', robots: { index: false, follow: false } };

export default async function AccountSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ github?: string }>;
}) {
  const { session, impersonation } = await getRequestIdentity();
  if (!session?.user.id)
    redirect(`/sign-in?callbackUrl=${encodeURIComponent(ACCOUNT_SETTINGS_PATH)}`);
  if (impersonation) redirect('/app');

  const publicationReady = isLegalPublicationReady();
  if (publicationReady) {
    const legal = await getUserLegalAcceptance(session.user.id);
    if (!legal || !hasCurrentLegalAcceptance(legal)) {
      redirect(`/legal/accept?returnTo=${encodeURIComponent(ACCOUNT_SETTINGS_PATH)}`);
    }
  }

  const [{ github }, [linked]] = await Promise.all([
    searchParams,
    db
      .select({ id: accounts.providerAccountId })
      .from(accounts)
      .where(and(eq(accounts.userId, session.user.id), eq(accounts.provider, 'github')))
      .limit(1),
  ]);
  const canLink = hasGitHubAuth && publicationReady;

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-5 py-10 sm:px-8">
      <Link href="/app" className="text-sm text-muted-foreground hover:text-foreground">
        Back to Timeline
      </Link>
      <PageHeader title="Account settings" />

      <section aria-labelledby="sign-in-methods" className="max-w-xl space-y-3">
        <SectionHeading id="sign-in-methods">Sign-in methods</SectionHeading>
        <div className="space-y-3 rounded-md border p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium">GitHub</h3>
              <p className="text-sm text-muted-foreground">
                {linked
                  ? 'Linked to your Timeline account.'
                  : canLink
                    ? 'Add GitHub as a way to sign in to this account.'
                    : 'GitHub linking is currently unavailable.'}
              </p>
            </div>
            {!linked && canLink ? (
              <form action={linkGitHubAction}>
                <Button type="submit" variant="outline" size="sm">
                  Link GitHub
                </Button>
              </form>
            ) : null}
          </div>
          {github === 'failed' ? (
            <p role="alert" className="text-sm text-destructive">
              GitHub linking couldn’t be completed. Try again or switch GitHub accounts.
            </p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
