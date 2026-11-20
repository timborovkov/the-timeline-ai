import { withTeam } from '@timeline/shared/team-scope';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { updateOcrBudget } from '@/app/actions/file-extraction';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export default async function OcrBudgetPage() {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');
  const scope = withTeam(db, active.teamId, session.user.id);
  if ((await scope.requireMembership()) !== 'owner') notFound();
  const budget = await scope.billing.getVisionBudget();
  return (
    <div className="space-y-5">
      <PageHeader title="OCR budget" subtitle="Control monthly vision extraction spend." />
      <dl className="grid gap-4 rounded-lg border p-4 sm:grid-cols-3">
        <div>
          <dt className="text-sm text-fg-muted">Spent this month</dt>
          <dd className="text-lg">{dollars.format(budget.spentCents / 100)}</dd>
        </div>
        <div>
          <dt className="text-sm text-fg-muted">Reserved</dt>
          <dd className="text-lg">{dollars.format(budget.reservedCents / 100)}</dd>
        </div>
        <div>
          <dt className="text-sm text-fg-muted">Maximum reserved per request</dt>
          <dd className="text-lg">{dollars.format(budget.estimateCents / 100)}</dd>
        </div>
      </dl>
      <form action={updateOcrBudget} className="max-w-md space-y-3">
        <label className="block space-y-1 text-sm">
          Monthly OCR limit (USD)
          <Input
            name="dollars"
            type="number"
            min="0"
            max="1000000"
            step="0.01"
            defaultValue={budget.capCents === null ? '' : budget.capCents / 100}
            placeholder="No cap"
          />
        </label>
        <p className="text-sm text-fg-muted">
          Leave blank for no cap. Enter zero to pause paid OCR. The budget resets at the start of
          each UTC month.
        </p>
        <Button size="sm" type="submit">
          Save budget
        </Button>
      </form>
      <Button asChild variant="outline">
        <Link href="/app/documents/captured">Open captured files</Link>
      </Button>
    </div>
  );
}
