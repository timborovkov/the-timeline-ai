import { notFound } from 'next/navigation';

import type * as jobRecovery from '@timeline/shared/job-recovery';
import type { Metadata } from 'next';

import { JobsForbiddenView, JobsPageView } from '@/components/job-recovery/jobs-page-view';
import { JobsPreviewShell } from '@/components/job-recovery/jobs-preview-shell';
import { QueryProvider } from '@/components/query-provider';

type JobRecoveryItem = jobRecovery.JobRecoveryItem;
type JobRecoveryKind = jobRecovery.JobRecoveryKind;

const BULK_PREVIEW_COUNT = 400;
const BULK_OLDER_COUNT = 8776;
const PREVIEW_KINDS: JobRecoveryKind[] = [
  'transcription',
  'extraction',
  'embedding',
  'document_processing',
  'meeting_finalization',
  'integration_sync',
];

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

function bulkPreviewJobs(): JobRecoveryItem[] {
  return Array.from({ length: BULK_PREVIEW_COUNT }, (_, index) => {
    const kind = PREVIEW_KINDS[index % PREVIEW_KINDS.length] ?? 'extraction';
    const failed = index % 3 === 0;
    return previewJob({
      id: `job-${String(index + 1)}`,
      kind,
      artifactKind: kind === 'embedding' ? 'calendar_event' : 'raw_event',
      artifactId: `artifact-${String(index + 1)}`,
      label: `${kind.replace(/_/g, ' ')} · event ${String(index + 1)}`,
      status: failed ? 'failed' : 'stuck',
      error: failed ? 'Processing timed out' : null,
      detectedAt: new Date(Date.UTC(2026, 7, 16, 15, 0, 0) - index * 60_000),
    });
  });
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
        ? { items: [] as JobRecoveryItem[], olderCount: BULK_OLDER_COUNT }
        : state === 'bulk'
          ? { items: bulkPreviewJobs(), olderCount: BULK_OLDER_COUNT }
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
              olderCount: BULK_OLDER_COUNT,
            };

  return (
    <QueryProvider>
      <JobsPreviewShell olderCount={queue.olderCount}>
        <main className="min-h-dvh bg-bg px-4 py-8 md:px-8">
          <div className="mx-auto w-full max-w-6xl">
            <JobsPageView teamName="AuditAI" items={queue.items} olderCount={queue.olderCount} />
          </div>
        </main>
      </JobsPreviewShell>
    </QueryProvider>
  );
}
