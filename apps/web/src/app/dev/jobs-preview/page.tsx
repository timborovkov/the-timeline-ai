import { notFound } from 'next/navigation';

import type * as jobRecovery from '@timeline/shared/job-recovery';
import type { Metadata } from 'next';

import { JobsForbiddenView, JobsPageView } from '@/components/job-recovery/jobs-page-view';
import { QueryProvider } from '@/components/query-provider';

type JobRecoveryItem = jobRecovery.JobRecoveryItem;

export const metadata: Metadata = {
  title: 'Jobs UI preview',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

function previewJob(overrides: Partial<JobRecoveryItem> = {}): JobRecoveryItem {
  return {
    id: 'job-1',
    kind: 'embedding',
    artifactKind: 'calendar_event',
    artifactId: 'cal-1',
    label: 'Embedding · calendar event from Aug 16, 2026, 12:00 PM',
    status: 'failed',
    error: 'Embedding timed out',
    retryable: true,
    detectedAt: new Date('2026-08-16T15:00:00.000Z'),
    ...overrides,
  };
}

export default async function JobsUiPreviewPage(props: {
  searchParams: Promise<{ state?: string }>;
}) {
  if (process.env.JOBS_UI_PREVIEW !== '1') notFound();
  const { state } = await props.searchParams;

  if (state === 'member') {
    return (
      <main className="min-h-dvh bg-bg px-4 py-8 md:px-8">
        <div className="mx-auto w-full max-w-6xl">
          <JobsForbiddenView teamName="AuditAI" />
        </div>
      </main>
    );
  }

  const queue =
    state === 'empty'
      ? { items: [] as JobRecoveryItem[], olderCount: 0 }
      : state === 'older'
        ? { items: [] as JobRecoveryItem[], olderCount: 8776 }
        : {
            items: [
              previewJob(),
              previewJob({
                id: 'job-2',
                kind: 'extraction',
                artifactKind: 'raw_event',
                artifactId: 'raw-1',
                label: 'Extraction · integration event from Aug 15, 2026, 8:52 PM',
                status: 'stuck',
                error: null,
                detectedAt: new Date('2026-08-15T20:52:00.000Z'),
              }),
            ],
            olderCount: 8776,
          };

  return (
    <QueryProvider>
      <main className="min-h-dvh bg-bg px-4 py-8 md:px-8">
        <div className="mx-auto w-full max-w-6xl">
          <JobsPageView teamName="AuditAI" items={queue.items} olderCount={queue.olderCount} />
        </div>
      </main>
    </QueryProvider>
  );
}
