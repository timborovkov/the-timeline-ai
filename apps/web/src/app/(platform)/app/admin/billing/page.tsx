import { users } from '@timeline/db';
import { isPlatformAdminEmail, polarCheckoutUrl } from '@timeline/shared/billing/operator';
import {
  findOperatorTeams,
  listBillingOperatorAudit,
  listOpenUnbilledAlerts,
  readOperatorBillingAccount,
} from '@timeline/shared/billing/operator-store';
import { getEnv } from '@timeline/shared/env';
import { eq } from 'drizzle-orm';
import { notFound, redirect } from 'next/navigation';

import { BillingOperatorTeamPanel } from '@/components/billing-operator-forms';
import { PageHeader } from '@/components/page-header';
import { SettingsSection } from '@/components/section-heading';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

const FIELD_CLASS =
  'mt-1 block w-full max-w-xs rounded-sm border border-border bg-bg px-3 py-2 text-sm text-fg';

export default async function BillingOperatorPage({
  searchParams,
}: {
  searchParams: Promise<{ team?: string; error?: string; notice?: string; checkout?: string }>;
}) {
  const { query, checkoutHref, unbilled, teamQuery, matches, selected, account, audit } =
    await loadBillingOperatorPage(searchParams);

  return (
    <div className="space-y-5">
      <PageHeader
        variant="collection"
        title="Operator billing"
        subtitle="Platform admins only. Comped plans skip Polar charges. Metering and the spend cap still apply."
      />
      {query.error ? <p className="text-sm text-danger">{query.error}</p> : null}
      {query.notice ? <p className="text-sm text-fg-muted">Saved.</p> : null}
      {checkoutHref ? (
        <p className="text-sm text-fg">
          <a
            href={checkoutHref}
            data-enterprise-checkout
            className="underline decoration-border underline-offset-4"
          >
            Open Enterprise checkout
          </a>
        </p>
      ) : null}

      <SettingsSection title="Unbilled usage">
        {unbilled.length === 0 ? (
          <p className="text-sm text-fg-muted">No open unbilled usage alerts.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {unbilled.map((alert) => (
              <li key={alert.id} data-unbilled-alert className="border border-border px-3 py-2">
                <p className="font-medium text-fg">
                  {alert.meterId} · {alert.periodYm} · {alert.reason}
                </p>
                {alert.detail ? <p className="text-fg-muted">{alert.detail}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </SettingsSection>

      {<BillingTeamSearch teamQuery={teamQuery} matches={matches} selected={selected} />}

      {selected && account ? (
        <BillingOperatorTeamPanel team={selected} account={account} audit={audit} />
      ) : null}
    </div>
  );
}

async function loadBillingOperatorPage(
  searchParams: Promise<{ team?: string; error?: string; notice?: string; checkout?: string }>,
) {
  const session = await auth();
  if (!session?.user.id || !session.user.email) redirect('/sign-in');
  const [operatorUser] = await db
    .select({ email: users.email, emailVerified: users.emailVerified })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  if (!operatorUser?.emailVerified || !operatorUser.email) notFound();
  if (operatorUser.email.toLowerCase() !== session.user.email.toLowerCase()) notFound();
  if (!isPlatformAdminEmail(operatorUser.email, getEnv().PLATFORM_ADMIN_EMAILS)) notFound();

  const query = await searchParams;
  const teamQuery = query.team?.trim() ?? '';
  const actor = { userId: session.user.id, email: operatorUser.email };
  const matches = teamQuery ? await findOperatorTeams({ db, actor, query: teamQuery }) : [];
  const selected =
    matches.find((team) => team.id === teamQuery || team.slug === teamQuery) ??
    (matches.length === 1 ? matches[0] : null);
  const account = selected
    ? await readOperatorBillingAccount({ db, actor, teamId: selected.id })
    : null;
  const audit = selected ? await listBillingOperatorAudit({ db, actor, teamId: selected.id }) : [];
  const unbilled = selected ? await listOpenUnbilledAlerts({ db, actor, teamId: selected.id }) : [];
  const checkoutHref = polarCheckoutUrl(query.checkout ?? '');
  return { query, checkoutHref, unbilled, teamQuery, matches, selected, account, audit };
}

function BillingTeamSearch({
  teamQuery,
  matches,
  selected,
}: {
  teamQuery: string;
  matches: { id: string; name: string; slug: string }[];
  selected: { id: string; name: string; slug: string } | null | undefined;
}) {
  return (
    <SettingsSection title="Find a team">
      <form action="/app/admin/billing" className="flex flex-wrap items-end gap-3">
        <label className="block text-sm">
          <span className="text-fg-muted">Team id, slug, or name</span>
          <input name="team" defaultValue={teamQuery} className={FIELD_CLASS} />
        </label>
        <button
          type="submit"
          className="inline-flex min-h-11 items-center rounded-sm bg-signal px-3 text-sm font-medium text-bg"
        >
          Find
        </button>
      </form>
      {teamQuery && matches.length === 0 ? (
        <p className="text-sm text-fg-muted">No matching team.</p>
      ) : null}
      {matches.length > 1 && !selected ? (
        <ul className="space-y-1 text-sm">
          {matches.map((team) => (
            <li key={team.id}>
              <a
                className="underline-offset-4 hover:underline"
                href={`/app/admin/billing?team=${team.id}`}
              >
                {team.name} ({team.slug})
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </SettingsSection>
  );
}
