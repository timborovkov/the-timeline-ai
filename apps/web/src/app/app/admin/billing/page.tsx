import { teamBillingAccounts } from '@timeline/db';
import { isPlatformAdminEmail } from '@timeline/shared/billing/operator';
import {
  findOperatorTeams,
  listBillingOperatorAudit,
} from '@timeline/shared/billing/operator-store';
import { getEnv } from '@timeline/shared/env';
import { eq } from 'drizzle-orm';
import { notFound, redirect } from 'next/navigation';

import {
  assignCompedPlanAction,
  clearCompedPlanAction,
  clearPolarDiscountAction,
  clearPriceOverrideAction,
  setOperatorSpendCapAction,
  setPolarDiscountAction,
  setPriceOverrideAction,
} from '@/app/actions/billing-operator';
import { PageHeader } from '@/components/page-header';
import { SettingsSection } from '@/components/section-heading';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

const FIELD_CLASS =
  'mt-1 block w-full max-w-xs rounded-sm border border-border bg-bg px-3 py-2 text-sm text-fg';

export default async function BillingOperatorPage({
  searchParams,
}: {
  searchParams: Promise<{ team?: string; error?: string; notice?: string }>;
}) {
  const session = await auth();
  if (!session?.user.id || !session.user.email) redirect('/sign-in');
  if (!isPlatformAdminEmail(session.user.email, getEnv().PLATFORM_ADMIN_EMAILS)) notFound();

  const query = await searchParams;
  const teamQuery = query.team?.trim() ?? '';
  const actor = { userId: session.user.id, email: session.user.email };
  const matches = teamQuery ? await findOperatorTeams({ db, actor, query: teamQuery }) : [];
  const selected =
    matches.find((team) => team.id === teamQuery || team.slug === teamQuery) ??
    (matches.length === 1 ? matches[0] : null);
  const account = selected
    ? ((
        await db
          .select()
          .from(teamBillingAccounts)
          .where(eq(teamBillingAccounts.teamId, selected.id))
          .limit(1)
      )[0] ?? null)
    : null;
  const audit = selected ? await listBillingOperatorAudit({ db, actor, teamId: selected.id }) : [];

  return (
    <div className="space-y-5">
      <PageHeader
        variant="collection"
        title="Operator billing"
        subtitle="Platform admins only. Comped plans skip Polar charges. Metering and the spend cap still apply."
      />
      {query.error ? <p className="text-sm text-danger">{query.error}</p> : null}
      {query.notice ? <p className="text-sm text-fg-muted">Saved.</p> : null}

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

      {selected && account ? (
        <>
          <SettingsSection title={`${selected.name} (${selected.slug})`}>
            <p className="font-mono text-xs text-fg-muted">{selected.id}</p>
            <p className="text-sm text-fg">
              {account.arrangement === 'comped' ? 'Comped' : 'Standard'} · {account.planId} · cap €
              {(account.spendCapCents / 100).toFixed(2)}
            </p>
          </SettingsSection>

          <SettingsSection title="Comped plan">
            <form action={assignCompedPlanAction} className="space-y-3">
              <input type="hidden" name="teamId" value={selected.id} />
              <label className="block text-sm">
                <span className="text-fg-muted">Entitlements</span>
                <select name="plan" defaultValue={account.planId} className={FIELD_CLASS}>
                  <option value="free">Free</option>
                  <option value="payg">Pay as you go</option>
                  <option value="team">Team</option>
                  <option value="business">Business</option>
                  <option value="enterprise">Enterprise</option>
                </select>
              </label>
              <label className="block text-sm">
                <span className="text-fg-muted">Spend cap (EUR)</span>
                <input
                  name="spendCapEuros"
                  type="number"
                  min={0}
                  step="0.01"
                  defaultValue={(account.spendCapCents / 100).toFixed(2)}
                  className={FIELD_CLASS}
                />
              </label>
              <label className="block text-sm">
                <span className="text-fg-muted">Reason</span>
                <input name="reason" required className={FIELD_CLASS} />
              </label>
              <label className="block text-sm">
                <span className="text-fg-muted">Expires (optional, UTC date)</span>
                <input name="expires" type="date" className={FIELD_CLASS} />
              </label>
              <button
                type="submit"
                className="inline-flex min-h-11 items-center rounded-sm bg-signal px-3 text-sm font-medium text-bg"
              >
                Assign comp
              </button>
            </form>
            {account.arrangement === 'comped' ? (
              <form action={clearCompedPlanAction}>
                <input type="hidden" name="teamId" value={selected.id} />
                <button
                  type="submit"
                  className="inline-flex min-h-11 items-center rounded-sm border border-border px-3 text-sm"
                >
                  Clear comp and return to Free
                </button>
              </form>
            ) : null}
          </SettingsSection>

          <SettingsSection title="Custom price">
            <form action={setPriceOverrideAction} className="space-y-3">
              <input type="hidden" name="teamId" value={selected.id} />
              <label className="block text-sm">
                <span className="text-fg-muted">Platform fee (EUR, optional)</span>
                <input
                  name="platformFeeEuros"
                  type="number"
                  min={0}
                  step="0.01"
                  className={FIELD_CLASS}
                />
              </label>
              <label className="block text-sm">
                <span className="text-fg-muted">Included members (optional)</span>
                <input
                  name="includedMembers"
                  type="number"
                  min={0}
                  step={1}
                  className={FIELD_CLASS}
                />
              </label>
              <label className="block text-sm">
                <span className="text-fg-muted">Extra member price (EUR / month, optional)</span>
                <input
                  name="memberEuros"
                  type="number"
                  min={0}
                  step="0.01"
                  className={FIELD_CLASS}
                />
              </label>
              <label className="block text-sm">
                <span className="text-fg-muted">Metered discount % (optional)</span>
                <input
                  name="meteredDiscountPercent"
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  className={FIELD_CLASS}
                />
              </label>
              <label className="block text-sm">
                <span className="text-fg-muted">Expires (optional, UTC date)</span>
                <input name="expires" type="date" className={FIELD_CLASS} />
              </label>
              <button
                type="submit"
                className="inline-flex min-h-11 items-center rounded-sm bg-signal px-3 text-sm font-medium text-bg"
              >
                Save price override
              </button>
            </form>
            <form action={clearPriceOverrideAction}>
              <input type="hidden" name="teamId" value={selected.id} />
              <button type="submit" className="text-sm underline-offset-4 hover:underline">
                Clear price override
              </button>
            </form>
          </SettingsSection>

          <SettingsSection title="Polar discount">
            <form action={setPolarDiscountAction} className="space-y-3">
              <input type="hidden" name="teamId" value={selected.id} />
              <label className="block text-sm">
                <span className="text-fg-muted">Polar discount id</span>
                <input name="polarDiscountId" className={FIELD_CLASS} />
              </label>
              <label className="block text-sm">
                <span className="text-fg-muted">Expires (optional, UTC date)</span>
                <input name="expires" type="date" className={FIELD_CLASS} />
              </label>
              <button
                type="submit"
                className="inline-flex min-h-11 items-center rounded-sm bg-signal px-3 text-sm font-medium text-bg"
              >
                Attach discount to checkout
              </button>
            </form>
            <form action={clearPolarDiscountAction}>
              <input type="hidden" name="teamId" value={selected.id} />
              <button type="submit" className="text-sm underline-offset-4 hover:underline">
                Clear Polar discount
              </button>
            </form>
            <form action={setOperatorSpendCapAction} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="teamId" value={selected.id} />
              <label className="block text-sm">
                <span className="text-fg-muted">Operator spend cap (EUR)</span>
                <input
                  name="spendCapEuros"
                  type="number"
                  min={0}
                  step="0.01"
                  defaultValue={(account.spendCapCents / 100).toFixed(2)}
                  className={FIELD_CLASS}
                />
              </label>
              <button
                type="submit"
                className="inline-flex min-h-11 items-center rounded-sm border border-border px-3 text-sm"
              >
                Update spend cap
              </button>
            </form>
          </SettingsSection>

          <SettingsSection title="Audit log">
            {audit.length === 0 ? (
              <p className="text-sm text-fg-muted">No operator changes yet.</p>
            ) : (
              <ul className="space-y-3 text-sm">
                {audit.map((entry) => (
                  <li key={entry.id} className="border border-border px-3 py-2">
                    <p className="font-medium text-fg">
                      {entry.action} · {entry.actorEmail}
                    </p>
                    <p className="font-mono text-xs text-fg-muted">
                      {entry.createdAt.toISOString()}
                    </p>
                    <p className="mt-1 font-mono text-xs text-fg-muted">
                      {entry.before.arrangement}/{entry.before.planId}/€
                      {(entry.before.spendCapCents / 100).toFixed(2)} → {entry.after.arrangement}/
                      {entry.after.planId}/€{(entry.after.spendCapCents / 100).toFixed(2)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </SettingsSection>
        </>
      ) : null}
    </div>
  );
}
