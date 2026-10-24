import type { teamBillingAccounts } from '@timeline/db';

import {
  assignCompedPlanAction,
  clearCompedPlanAction,
  clearPolarDiscountAction,
  clearPriceOverrideAction,
  setOperatorSpendCapAction,
  setPolarDiscountAction,
  setPriceOverrideAction,
  startEnterpriseCheckoutAction,
} from '@/app/actions/billing-operator';
import { SettingsSection } from '@/components/section-heading';

const FIELD_CLASS =
  'mt-1 block w-full max-w-xs rounded-sm border border-border bg-bg px-3 py-2 text-sm text-fg';

type OperatorAccount = Pick<
  typeof teamBillingAccounts.$inferSelect,
  'arrangement' | 'planId' | 'spendCapCents'
>;

interface OperatorAuditEntry {
  id: string;
  action: string;
  actorEmail: string;
  createdAt: Date;
  before: { arrangement: string; planId: string; spendCapCents: number };
  after: { arrangement: string; planId: string; spendCapCents: number };
}

function OperatorTeamSummary(props: {
  team: { id: string; name: string; slug: string };
  account: OperatorAccount;
}) {
  return (
    <SettingsSection title={`${props.team.name} (${props.team.slug})`}>
      <p className="font-mono text-xs text-fg-muted">{props.team.id}</p>
      <p className="text-sm text-fg">
        {props.account.arrangement === 'comped' ? 'Comped' : 'Standard'} · {props.account.planId} ·
        cap €{(props.account.spendCapCents / 100).toFixed(2)}
      </p>
    </SettingsSection>
  );
}

function OperatorCompForm(props: { teamId: string; account: OperatorAccount }) {
  return (
    <SettingsSection title="Comped plan">
      <form action={assignCompedPlanAction} className="space-y-3">
        <input type="hidden" name="teamId" value={props.teamId} />
        <label className="block text-sm">
          <span className="text-fg-muted">Entitlements</span>
          <select name="plan" defaultValue={props.account.planId} className={FIELD_CLASS}>
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
            defaultValue={(props.account.spendCapCents / 100).toFixed(2)}
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
      {props.account.arrangement === 'comped' ? (
        <form action={clearCompedPlanAction}>
          <input type="hidden" name="teamId" value={props.teamId} />
          <button
            type="submit"
            className="inline-flex min-h-11 items-center rounded-sm border border-border px-3 text-sm"
          >
            Clear comp and return to Free
          </button>
        </form>
      ) : null}
    </SettingsSection>
  );
}

function OperatorPriceForm(props: { teamId: string }) {
  return (
    <SettingsSection title="Custom price">
      <form action={setPriceOverrideAction} className="space-y-3">
        <input type="hidden" name="teamId" value={props.teamId} />
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
          <input name="includedMembers" type="number" min={0} step={1} className={FIELD_CLASS} />
        </label>
        <label className="block text-sm">
          <span className="text-fg-muted">Extra member price (EUR / month, optional)</span>
          <input name="memberEuros" type="number" min={0} step="0.01" className={FIELD_CLASS} />
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
        <input type="hidden" name="teamId" value={props.teamId} />
        <button type="submit" className="text-sm underline-offset-4 hover:underline">
          Clear price override
        </button>
      </form>
    </SettingsSection>
  );
}

function OperatorEnterpriseForm(props: { teamId: string }) {
  return (
    <SettingsSection title="Enterprise checkout">
      <p className="text-sm text-fg-muted">
        Saves Enterprise terms, then opens a Timeline Enterprise checkout for the negotiated
        platform fee. Metered usage and extra members invoice on that subscription. Cancel any
        current Polar subscription first.
      </p>
      <form action={startEnterpriseCheckoutAction} className="space-y-3">
        <input type="hidden" name="teamId" value={props.teamId} />
        <label className="block text-sm">
          <span className="text-fg-muted">Platform fee (EUR)</span>
          <input
            name="platformFeeEuros"
            type="number"
            min={0}
            step="0.01"
            required
            className={FIELD_CLASS}
          />
        </label>
        <label className="block text-sm">
          <span className="text-fg-muted">Included members (optional)</span>
          <input name="includedMembers" type="number" min={0} step={1} className={FIELD_CLASS} />
        </label>
        <label className="block text-sm">
          <span className="text-fg-muted">Extra member price (EUR / month, optional)</span>
          <input name="memberEuros" type="number" min={0} step="0.01" className={FIELD_CLASS} />
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
          <span className="text-fg-muted">Spend cap (EUR, optional)</span>
          <input name="spendCapEuros" type="number" min={0} step="0.01" className={FIELD_CLASS} />
        </label>
        <button
          type="submit"
          className="inline-flex min-h-11 items-center rounded-sm bg-signal px-3 text-sm font-medium text-bg"
        >
          Open Enterprise checkout
        </button>
      </form>
    </SettingsSection>
  );
}

function OperatorDiscountForm(props: { teamId: string; spendCapCents: number }) {
  return (
    <SettingsSection title="Polar discount">
      <form action={setPolarDiscountAction} className="space-y-3">
        <input type="hidden" name="teamId" value={props.teamId} />
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
        <input type="hidden" name="teamId" value={props.teamId} />
        <button type="submit" className="text-sm underline-offset-4 hover:underline">
          Clear Polar discount
        </button>
      </form>
      <form action={setOperatorSpendCapAction} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="teamId" value={props.teamId} />
        <label className="block text-sm">
          <span className="text-fg-muted">Operator spend cap (EUR)</span>
          <input
            name="spendCapEuros"
            type="number"
            min={0}
            step="0.01"
            defaultValue={(props.spendCapCents / 100).toFixed(2)}
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
  );
}

function OperatorAuditList(props: { audit: OperatorAuditEntry[] }) {
  return (
    <SettingsSection title="Audit log">
      {props.audit.length === 0 ? (
        <p className="text-sm text-fg-muted">No operator changes yet.</p>
      ) : (
        <ul className="space-y-3 text-sm">
          {props.audit.map((entry) => (
            <li key={entry.id} className="border border-border px-3 py-2">
              <p className="font-medium text-fg">
                {entry.action} · {entry.actorEmail}
              </p>
              <p className="font-mono text-xs text-fg-muted">{entry.createdAt.toISOString()}</p>
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
  );
}

export function BillingOperatorTeamPanel(props: {
  team: { id: string; name: string; slug: string };
  account: OperatorAccount;
  audit: OperatorAuditEntry[];
}) {
  return (
    <>
      <OperatorTeamSummary team={props.team} account={props.account} />
      <OperatorCompForm teamId={props.team.id} account={props.account} />
      <OperatorPriceForm teamId={props.team.id} />
      <OperatorEnterpriseForm teamId={props.team.id} />
      <OperatorDiscountForm teamId={props.team.id} spendCapCents={props.account.spendCapCents} />
      <OperatorAuditList audit={props.audit} />
    </>
  );
}
