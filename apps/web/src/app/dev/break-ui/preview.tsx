'use client';

import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

import type { Dataset } from '@/app/dev/break-ui/fixtures';

import { DATASETS, relatedMemberFixtures } from '@/app/dev/break-ui/fixtures';
import { PendingInvitesCard } from '@/components/pending-invites-card';
import { RemovedMembersCard } from '@/components/removed-members-card';
import { MembersCard } from '@/components/team-members-card';

const LABELS: Record<Dataset, string> = {
  demo: 'Demo data',
  worst: 'Worst case',
  empty: 'Empty',
  one: 'One',
  huge: '1,284 rows',
};

export function MembersStressPreview({
  initialDataset,
  siteUrl,
}: {
  initialDataset: Dataset;
  siteUrl: string;
}) {
  const params = useSearchParams();
  const dataset = DATASETS.find((value) => value === params.get('data')) ?? initialDataset;
  const [viewer, setViewer] = useState('owner');
  const fixture = relatedMemberFixtures(dataset);
  const surface = params.get('surface') ?? 'members';
  return (
    <main className="min-h-dvh bg-bg px-4 py-8 pb-40 md:ml-60 md:px-8">
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold">Team members stress test</h1>
          <p className="text-sm text-fg-muted">
            Development preview · synthetic profiles · submissions blocked
          </p>
          <label className="flex flex-wrap items-center gap-2 text-sm">
            View as
            <select
              aria-label="View as"
              value={viewer}
              onChange={(event) => {
                setViewer(event.target.value);
              }}
              className="rounded border border-border bg-bg p-1"
            >
              <option value="owner">Owner</option>
              <option value="admin">Admin</option>
              <option value="member">Member</option>
            </select>
          </label>
          <label className="flex flex-wrap items-center gap-2 text-sm">
            Surface
            <select
              aria-label="Surface"
              value={surface}
              className="max-w-full rounded border border-border bg-bg p-1"
              onChange={(event) => {
                const url = new URL(window.location.href);
                url.searchParams.set('surface', event.target.value);
                window.history.pushState(null, '', url);
              }}
            >
              <option value="members">Members</option>
              <option value="invites">Pending invites</option>
              <option value="removed">Removed members</option>
            </select>
          </label>
        </header>
        <div
          data-testid="member-surface"
          onSubmitCapture={(event) => {
            event.preventDefault();
          }}
        >
          {surface === 'invites' ? (
            <PendingInvitesCard
              siteUrl={siteUrl}
              key={dataset}
              invites={fixture.invites}
              userMap={fixture.userMap}
            />
          ) : surface === 'removed' ? (
            <RemovedMembersCard
              key={dataset}
              removedMembers={fixture.removedMembers}
              userMap={fixture.userMap}
            />
          ) : (
            <MembersCard
              key={`${dataset}-${viewer}`}
              {...fixture}
              isOwner={viewer === 'owner'}
              isAdmin={viewer !== 'member'}
              currentUserId="break-ui-member-0"
            />
          )}
        </div>
      </div>
      <nav
        aria-label="Stress test dataset"
        className="fixed bottom-[16px] left-1/2 z-40 flex w-max max-w-[calc(100%-32px)] -translate-x-1/2 flex-wrap justify-center gap-1 rounded-lg bg-neutral-200 p-1 font-sans text-[12px] text-neutral-900 shadow-sm"
      >
        {DATASETS.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={dataset === value}
            className={`rounded-md px-[12px] py-[8px] ${dataset === value ? 'bg-white' : ''}`}
            onClick={() => {
              const url = new URL(window.location.href);
              url.searchParams.set('data', value);
              window.history.pushState(null, '', url);
            }}
          >
            {LABELS[value]}
          </button>
        ))}
      </nav>
    </main>
  );
}
