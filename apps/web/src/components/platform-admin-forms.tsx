'use client';
import { useFormStatus } from 'react-dom';

import type { ReactNode } from 'react';

import {
  adminRenameAction,
  adminSuspendAction,
  adminImpersonateAction,
  adminMembershipAction,
} from '@/app/actions/platform-admin';

const inputClass = 'block min-h-11 w-full rounded-sm border border-border bg-bg px-3 py-2 text-sm';
const buttonClass =
  'min-h-11 rounded-sm border border-border px-3 py-2 text-sm font-medium hover:bg-surface-2';
export function AdminRenameForm({
  kind,
  id,
  name,
}: {
  kind: 'user' | 'team';
  id: string;
  name: string;
}) {
  return (
    <form action={adminRenameAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      <label className="flex-1 text-sm">
        {kind === 'user' ? 'Display name' : 'Team name'}
        <input
          className={inputClass}
          name="name"
          defaultValue={name}
          required
          maxLength={kind === 'team' ? 80 : 120}
        />
      </label>
      <AdminSubmit>Save name</AdminSubmit>
    </form>
  );
}
export function AdminSuspendForm({
  kind,
  id,
  suspended,
}: {
  kind: 'user' | 'team';
  id: string;
  suspended: boolean;
}) {
  return (
    <details className="rounded-md border border-border p-4">
      <summary className="cursor-pointer font-medium">
        {suspended ? 'Restore access' : `${kind === 'team' ? 'Disable' : 'Suspend'} ${kind}`}
      </summary>
      <form action={adminSuspendAction} className="mt-3 space-y-3">
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="suspended" value={String(!suspended)} />
        <p className="text-sm text-fg-muted">
          {suspended
            ? 'Restore access without resuming subscription renewal. A pending deletion request is canceled.'
            : 'Block access and new processing. Team data is retained; disabling a team stops new usage accrual and cancels renewal.'}
        </p>
        <label className="block text-sm">
          Reason
          <textarea name="reason" required minLength={3} maxLength={1000} className={inputClass} />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="confirmed" value="yes" required />I confirm this change
        </label>
        <AdminSubmit>{suspended ? 'Restore access' : 'Suspend access'}</AdminSubmit>
      </form>
    </details>
  );
}
export function AdminImpersonateForm({ teamId, userId }: { teamId: string; userId: string }) {
  return (
    <details className="rounded-md border border-border p-3">
      <summary className="cursor-pointer text-sm font-medium">Log in as this member</summary>
      <form
        action={async (data) => {
          await adminImpersonateAction(data);
          window.location.assign('/app');
        }}
        className="mt-3 space-y-3"
      >
        <input type="hidden" name="teamId" value={teamId} />
        <input type="hidden" name="userId" value={userId} />
        <p className="text-sm text-fg-muted">
          Uses this member’s permissions for 30 minutes. Activity is audited. Suspended accounts and
          teams are read-only.
        </p>
        <label className="block text-sm">
          Purpose
          <textarea className={inputClass} name="purpose" required minLength={3} maxLength={1000} />
        </label>
        <label className="block text-sm">
          Support ticket or incident reference
          <input className={inputClass} name="reference" required maxLength={200} />
        </label>
        <label className="block text-sm">
          Customer authorization and approving person, or emergency incident context
          <textarea
            className={inputClass}
            name="authorization"
            required
            minLength={3}
            maxLength={1000}
          />
        </label>
        <AdminSubmit>Start 30-minute session</AdminSubmit>
      </form>
    </details>
  );
}
export function AdminMembershipForm({
  teamId,
  userId,
  role,
}: {
  teamId: string;
  userId: string;
  role: 'admin' | 'member';
}) {
  return (
    <details className="rounded-md border border-border p-3">
      <summary className="cursor-pointer text-sm">Manage membership</summary>
      <form action={adminMembershipAction} className="mt-3 space-y-3">
        <input type="hidden" name="teamId" value={teamId} />
        <input type="hidden" name="userId" value={userId} />
        <label className="block text-sm">
          Role
          <select className={inputClass} name="role" defaultValue={role}>
            <option value="member">Member</option>
            <option value="admin">Admin</option>
            <option value="removed">Remove from team</option>
          </select>
        </label>
        <label className="block text-sm">
          Reason
          <input className={inputClass} name="reason" required minLength={3} maxLength={1000} />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="confirmed" value="yes" required />
          Confirm membership change
        </label>
        <AdminSubmit>Save membership</AdminSubmit>
      </form>
    </details>
  );
}

function AdminSubmit({ children }: { children: ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={buttonClass}>
      {pending ? 'Working…' : children}
    </button>
  );
}
