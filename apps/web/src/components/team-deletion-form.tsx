'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import { deleteTeamAction, requestTeamDeletionAction } from '@/app/actions/team-lifecycle';

export function TeamDeletionForm({
  teamId,
  teamName,
  admin = false,
}: {
  teamId: string;
  teamName: string;
  admin?: boolean;
}) {
  const [error, action, pending] = useActionState(async (_previous: string, data: FormData) => {
    try {
      await (admin ? deleteTeamAction : requestTeamDeletionAction)(data);
    } catch (error) {
      // Next redirects must propagate to the framework.
      if (
        error &&
        typeof error === 'object' &&
        'digest' in error &&
        String(error.digest).startsWith('NEXT_REDIRECT')
      )
        throw error;
      return error instanceof Error ? error.message : 'Unable to submit. Please retry.';
    }
    return '';
  }, '');
  return (
    <details className="rounded-md border border-danger p-4">
      <summary className="cursor-pointer font-medium text-danger">
        {admin ? 'Permanently delete team' : 'Request permanent deletion'}
      </summary>
      <form action={action} className="mt-4 space-y-4">
        <input type="hidden" name="teamId" value={teamId} />
        <p className="text-sm">
          {admin
            ? 'Deletion starts immediately and cannot be reversed.'
            : 'This immediately disables the team for every member. Platform admins will review your deletion request. Only platform admins can restore access before deletion starts.'}{' '}
          All team content, including members’ private content, will be removed. User accounts and
          other teams are preserved.
        </p>
        <p className="text-sm text-fg-muted">
          New usage charges stop and cancellation of subscription renewal is requested and retried
          if the billing provider is unavailable. Previously incurred charges remain payable; no
          automatic refunds. Backups, provider copies and limited financial/security records follow
          their retention requirements.
        </p>
        {!admin && (
          <Link className="text-sm underline" href="/app/team?section=exports">
            Export data you can access before requesting deletion
          </Link>
        )}
        <label className="block text-sm">
          Type the team name: <strong>{teamName}</strong>
          <input
            name="confirmation"
            required
            autoComplete="off"
            className="mt-1 min-h-11 w-full rounded-sm border border-border bg-bg px-3"
          />
        </label>
        {admin && (
          <label className="block text-sm">
            Reason
            <textarea
              name="reason"
              required
              minLength={3}
              maxLength={1000}
              className="mt-1 min-h-20 w-full rounded-sm border border-border bg-bg p-3"
            />
          </label>
        )}
        <label className="flex gap-2 text-sm">
          <input type="checkbox" name="confirmed" value="yes" required />I understand this affects
          every member and all team content.
        </label>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 rounded-sm border border-danger px-4 text-sm text-danger"
        >
          {pending
            ? 'Submitting…'
            : admin
              ? 'Permanently delete team'
              : 'Disable team and request deletion'}
        </button>
      </form>
    </details>
  );
}
