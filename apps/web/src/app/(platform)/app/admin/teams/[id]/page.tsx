import {
  readPlatformTeam,
  listPlatformAudit,
  type PlatformActor,
} from '@timeline/shared/platform-admin';
import { directoryPage, type DirectoryOptions } from '@timeline/shared/platform-admin';
import { listTeamRetentionHolds } from '@timeline/shared/team-lifecycle';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { retryTeamCleanupAction, recordDeletionFollowupAction } from '@/app/actions/team-lifecycle';
import { CopyableTextField } from '@/components/copyable-text-field';
import { PageHeader } from '@/components/page-header';
import { AdminMembershipFilters, AdminPagination } from '@/components/platform-admin-directory';
import {
  AdminRenameForm,
  AdminSuspendForm,
  AdminImpersonateForm,
  AdminMembershipForm,
} from '@/components/platform-admin-forms';
import { TeamDeletionForm } from '@/components/team-deletion-form';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/platform-admin';
export default async function AdminTeamPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<DirectoryOptions & { error?: string }>;
}) {
  const actor = await requireAdmin();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const options = await searchParams;
  const team = await readPlatformTeam(db, actor, id, { direction: 'asc', ...options });
  if (!team) notFound();
  const { error } = await searchParams;
  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader
        variant="collection"
        title={team.name}
        subtitle={`${team.slug} · ${team.securityState ?? 'normal'} · ${team.planId ?? 'free'}`}
      />
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <CopyableTextField id="team-id" label="Team ID" value={id} />
      <TeamMetadata team={team} />
      <TeamCleanupProgress team={team} id={id} />
      {!team.deletionStartedAt && <AdminRenameForm kind="team" id={id} name={team.name} />}
      <Link className="inline-block text-sm underline" href={`/app/admin/billing?team=${id}`}>
        Manage billing
      </Link>
      {!team.deletionStartedAt && (
        <>
          <AdminSuspendForm
            kind="team"
            id={id}
            suspended={team.securityState === 'suspended' || Boolean(team.disabledAt)}
          />
          <TeamDeletionForm teamId={id} teamName={team.name} admin />
        </>
      )}
      <TeamMembers team={team} id={id} actor={actor} options={options} />
      <TeamLifecycleHistory id={id} actor={actor} />
    </div>
  );
}

type TeamDetail = NonNullable<Awaited<ReturnType<typeof readPlatformTeam>>>;
function TeamMetadata({ team }: { team: TeamDetail }) {
  return (
    <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
      <div>
        <dt className="text-fg-muted">Created</dt>
        <dd>{team.createdAt.toISOString()}</dd>
      </div>
      <div>
        <dt className="text-fg-muted">Disabled</dt>
        <dd>
          {team.lifecycleWork.disabledDateUnknown
            ? 'Unknown'
            : (team.disabledAt?.toISOString() ??
              (team.securityState === 'suspended' ? 'Date unknown' : 'No'))}
        </dd>
      </div>
      <div>
        <dt className="text-fg-muted">Disabled by</dt>
        <dd>{team.disabledByUserId ?? '—'}</dd>
      </div>
      <div>
        <dt className="text-fg-muted">Reason</dt>
        <dd>{team.disabledReason ?? '—'}</dd>
      </div>
      <div>
        <dt className="text-fg-muted">Deletion requested</dt>
        <dd>{team.deletionRequestedAt?.toISOString() ?? 'No'}</dd>
      </div>
      <div>
        <dt className="text-fg-muted">Requester ID</dt>
        <dd>{team.deletionRequestedByUserId ?? '—'}</dd>
      </div>
      <div>
        <dt className="text-fg-muted">Billing status</dt>
        <dd>{team.billingState ?? 'No account'}</dd>
      </div>
      <div>
        <dt className="text-fg-muted">Billing cancellation</dt>
        <dd>{team.lifecycleWork.billingPending ? 'Pending retry' : 'No pending cancellation'}</dd>
      </div>
      <div>
        <dt className="text-fg-muted">Notification</dt>
        <dd>{team.lifecycleWork.notificationPending ? 'Pending retry' : 'No pending delivery'}</dd>
      </div>
    </dl>
  );
}
function TeamCleanupProgress({ team, id }: { team: TeamDetail; id: string }) {
  return (
    <>
      {team.deletionStartedAt && (
        <section className="space-y-2 rounded-md border border-border p-4">
          <h2 className="font-semibold">
            {team.deletedAt ? 'Active-system data removed' : 'Permanent deletion in progress'}
          </h2>
          <p className="text-sm">
            Stage: {team.lifecycleWork.stage}. Started: {team.deletionStartedAt.toISOString()}
          </p>
          {team.lifecycleWork.verifiedAt && (
            <p className="text-sm">Verified: {team.lifecycleWork.verifiedAt}</p>
          )}
          <p className="text-sm">{team.lifecycleWork.externalFollowup}</p>
          {(team.lifecycleWork.followups ?? []).map((followup) => (
            <form
              key={followup.category}
              action={recordDeletionFollowupAction}
              className="space-y-2 border-t border-border pt-3 text-sm"
            >
              <input type="hidden" name="teamId" value={id} />
              <input type="hidden" name="category" value={followup.category} />
              <h3 className="font-medium">{followup.category.replaceAll('_', ' ')}</h3>
              <label className="block">
                Status
                <select
                  name="status"
                  defaultValue={followup.status}
                  className="ml-2 min-h-11 rounded-sm border border-border bg-bg px-3"
                >
                  <option value="pending">Pending verification</option>
                  <option value="retained">Retained with expiry/review</option>
                  <option value="complete">Verified complete</option>
                </select>
              </label>
              <label className="block">
                Receipt or retention basis (no customer content)
                <input
                  name="reference"
                  defaultValue={followup.reference}
                  required
                  minLength={3}
                  maxLength={1000}
                  className="block min-h-11 w-full rounded-sm border border-border bg-bg px-3"
                />
              </label>
              <label className="block">
                Expiry or review date
                <input
                  type="date"
                  name="expiresAt"
                  defaultValue={followup.expiresAt?.slice(0, 10) ?? ''}
                  className="ml-2 min-h-11 rounded-sm border border-border bg-bg px-3"
                />
              </label>
              <button type="submit" className="min-h-11 rounded-sm border border-border px-3">
                Record follow-up
              </button>
            </form>
          ))}
        </section>
      )}
      {team.lifecycleWork.error && (
        <div role="alert" className="space-y-2 text-sm">
          <p>
            {team.lifecycleWork.error}. Attempts: {team.lifecycleWork.attempts}. Next attempt:{' '}
            {team.lifecycleWork.retryAt ?? 'Next worker tick'}
          </p>
          <form action={retryTeamCleanupAction}>
            <input type="hidden" name="teamId" value={id} />
            <button type="submit" className="min-h-11 rounded-sm border border-border px-3">
              Retry cleanup
            </button>
          </form>
        </div>
      )}
    </>
  );
}
function TeamMembers({
  team,
  id,
  actor,
  options,
}: {
  team: TeamDetail;
  id: string;
  actor: PlatformActor;
  options: DirectoryOptions;
}) {
  return (
    <section className="space-y-3">
      <h2 className="font-semibold">Members</h2>
      <p className="text-sm">Connected sources: {team.integrationCount}</p>
      {!team.deletionStartedAt && <AdminMembershipFilters options={options} />}
      {team.members.length === 0 && <p className="text-sm text-fg-muted">No members.</p>}
      {(team.deletionStartedAt ? [] : team.members).slice(0, 50).map((m) => (
        <div key={m.id} className="space-y-3 rounded-md border border-border p-4">
          <Link className="font-medium hover:underline" href={`/app/admin/users/${m.id}`}>
            {m.name ?? m.email}
          </Link>
          <p className="text-sm text-fg-muted">
            {m.email} · {m.role} ·{' '}
            {m.removedAt ? 'Removed' : m.suspendedAt ? 'Suspended' : 'Active'}
          </p>
          <CopyableTextField id={`member-${m.id}`} label="User ID" value={m.id} />
          {!m.removedAt && m.id !== actor.userId && (
            <AdminImpersonateForm teamId={id} userId={m.id} />
          )}{' '}
          {!m.removedAt && m.role !== 'owner' && (
            <AdminMembershipForm teamId={id} userId={m.id} role={m.role} />
          )}
        </div>
      ))}
      <AdminPagination
        page={directoryPage(options.page)}
        hasNext={team.members.length > 50}
        options={options}
      />
    </section>
  );
}
async function TeamLifecycleHistory({ id, actor }: { id: string; actor: PlatformActor }) {
  const [history, holds] = await Promise.all([
    listPlatformAudit(db, actor, 1, { team: id }),
    listTeamRetentionHolds(db, actor, id),
  ]);
  return (
    <section className="space-y-3 text-sm">
      <h2 className="font-semibold">Lifecycle history and retention holds</h2>
      <ul>
        {history.slice(0, 10).map((entry) => (
          <li key={entry.id}>
            {entry.createdAt.toISOString()} · {entry.action} · {entry.actorEmail}
            {entry.reason ? ` · ${entry.reason}` : ''}
          </li>
        ))}
      </ul>
      <Link className="underline" href={`/app/admin/audit?team=${id}`}>
        Browse full history
      </Link>
      {holds.length === 0 ? (
        <p>No active security retention holds.</p>
      ) : (
        <ul>
          {holds.map((hold) => (
            <li key={hold.id}>{hold.reason}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
