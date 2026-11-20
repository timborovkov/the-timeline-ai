import { VISION_BUDGET_DEFERRED } from '@timeline/shared/billing';
import { isStaleExtractionAttempt } from '@timeline/shared/documents';
import { withTeam } from '@timeline/shared/team-scope';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';

import { FileExtractionAction } from '@/components/captured-files/file-extraction-action';
import { PageHeader } from '@/components/page-header';
import { RelativeTimestamp } from '@/components/relative-timestamp';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

type TeamScope = ReturnType<typeof withTeam>;
type ExtractionHistory = Awaited<ReturnType<TeamScope['documents']['listExtractionCorrections']>>;

interface CapturedFile {
  id: string;
  name: string;
  currentVersionId: string;
}

async function renderPreviousExtraction(
  scope: TeamScope,
  file: CapturedFile,
  versionId?: string,
  chunkId?: string,
) {
  const version = z.uuid().safeParse(versionId);
  const chunk = z.uuid().safeParse(chunkId);
  if (!version.success || !chunk.success) notFound();
  const citedChunk = await scope.documents.getHistoricalDocumentChunk(
    file.id,
    version.data,
    chunk.data,
  );
  if (!citedChunk) notFound();
  return (
    <div className="space-y-5">
      <Link className="text-sm underline" href={`/app/documents/captured/${file.id}/extraction`}>
        Open current extraction
      </Link>
      <PageHeader title={file.name} subtitle="Previous extraction" />
      <p className="whitespace-pre-wrap text-sm">{citedChunk.text}</p>
    </div>
  );
}

function canStartExtraction(
  deferred: boolean,
  latest: ExtractionHistory[number] | undefined,
  staleExtracting: boolean,
) {
  if (deferred || staleExtracting || !latest) return true;
  return latest.status === 'deferred' || ['applied', 'failed', 'pending'].includes(latest.status);
}

async function renderCurrentExtraction(scope: TeamScope, file: CapturedFile) {
  const [version, history] = await Promise.all([
    scope.documents.getDocumentVersion(file.currentVersionId),
    scope.documents.listExtractionCorrections(file.id),
  ]);
  if (!version) notFound();
  const deferred = version.processingError === VISION_BUDGET_DEFERRED;
  const latest = history[0];
  const staleExtracting = Boolean(latest && isStaleExtractionAttempt(latest));
  return (
    <div className="space-y-5">
      <Link className="text-sm underline" href="/app/documents/captured">
        Captured files
      </Link>
      <PageHeader title={file.name} subtitle="Extraction history" />
      {deferred ? (
        <p className="text-sm text-fg-muted">
          Deferred by OCR budget. The original file remains available.
        </p>
      ) : null}
      {staleExtracting ? (
        <p className="text-sm text-fg-muted">
          The previous extraction attempt stalled. You can retry it.
        </p>
      ) : null}
      {canStartExtraction(deferred, latest, staleExtracting) ? (
        <FileExtractionAction id={file.id} resume={deferred} />
      ) : null}
      {!history.length ? (
        <p className="text-sm text-fg-muted">No second extraction has been requested.</p>
      ) : null}
      <ExtractionAttempts history={history} id={file.id} />
    </div>
  );
}

export default async function FileExtractionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ version?: string; chunk?: string }>;
}) {
  const [{ id }, { version: citedVersionId, chunk: citedChunkId }, session] = await Promise.all([
    params,
    searchParams,
    auth(),
  ]);
  if (!session?.user) redirect('/sign-in');
  if (!z.uuid().safeParse(id).success) notFound();
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');
  const scope = withTeam(db, active.teamId, session.user.id);
  const file = await scope.documents.getDocument(id);
  if (!file?.currentVersionId) notFound();
  const current = {
    id: file.id,
    name: file.name,
    currentVersionId: file.currentVersionId,
  };
  if (citedVersionId || citedChunkId) {
    return renderPreviousExtraction(scope, current, citedVersionId, citedChunkId);
  }
  return renderCurrentExtraction(scope, current);
}

function ExtractionAttempts({ history, id }: { history: ExtractionHistory; id: string }) {
  return (
    <>
      {history.map((attempt) => (
        <section key={attempt.id} className="space-y-2 rounded-lg border p-4">
          <h2 className="text-sm font-medium capitalize">
            {attempt.status === 'deferred' ? 'Deferred by OCR budget' : attempt.status}
          </h2>
          <RelativeTimestamp value={attempt.createdAt} />
          {attempt.representations?.map((representation) => (
            <details key={representation.kind} className="space-y-2 text-sm">
              <summary>{representation.kind.replaceAll('_', ' ')}</summary>
              <p className="max-h-80 overflow-auto whitespace-pre-wrap">{representation.text}</p>
            </details>
          ))}
          {attempt.previous?.length ? (
            <details className="space-y-2 text-sm">
              <summary>Previous extraction</summary>
              <p className="max-h-80 overflow-auto whitespace-pre-wrap">
                {attempt.previous.map((part) => part.text).join('\n\n')}
              </p>
            </details>
          ) : null}
          {attempt.status === 'ready' ||
          (attempt.status === 'applied' && !attempt.indexQueuedAt) ? (
            <FileExtractionAction
              id={id}
              attemptId={attempt.id}
              retryIndex={attempt.status === 'applied'}
            />
          ) : null}
        </section>
      ))}
    </>
  );
}
