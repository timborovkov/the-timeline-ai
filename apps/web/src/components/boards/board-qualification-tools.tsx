'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';

import { previewBoardMatchesAction, scanBoardMatchesAction } from '@/app/actions/boards';
import { Button } from '@/components/ui/button';

interface Match {
  id: string;
  name: string;
  decision: string;
  reason: string;
}
const LABELS: Record<string, string> = {
  add: 'Would suggest adding',
  remove: 'Would suggest removing',
  no_change: 'No change',
  insufficient_evidence: 'Not enough information',
};
export function BoardQualificationTools({ boardId }: { boardId: string }) {
  const [pending, startTransition] = useTransition();
  const [matches, setMatches] = useState<Match[]>([]);
  const [message, setMessage] = useState('');
  const [cursor, setCursor] = useState<string | undefined>();
  function preview() {
    startTransition(async () => {
      setMessage('Checking a sample of up to three recent objects…');
      const result = await previewBoardMatchesAction({ boardId });
      if (result.error) {
        setMessage(result.error);
        return;
      }
      setMatches(result.matches ?? []);
      setMessage(result.warning ?? 'Preview only. No objects were added or removed.');
    });
  }
  function scan() {
    startTransition(async () => {
      const result = await scanBoardMatchesAction({ boardId, afterId: cursor });
      if ('error' in result) {
        setMessage(result.error);
        return;
      }
      setCursor(result.nextCursor ?? undefined);
      setMessage(
        `${result.count} objects queued for review. Matches will appear in Approvals.${result.nextCursor ? ' Continue to check the next batch.' : ' All batches queued.'}`,
      );
    });
  }
  return (
    <details className="shrink-0 border-b border-border px-4 py-2 text-sm">
      <summary className="cursor-pointer text-fg-muted">Membership suggestions</summary>
      <div className="space-y-2 py-3">
        <p className="text-xs text-fg-muted">
          New object changes are checked automatically. Save criteria in Board settings before
          previewing or checking existing objects.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" disabled={pending} onClick={preview}>
            Preview matches
          </Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={scan}>
            {cursor ? 'Check next 50 objects' : 'Check existing objects'}
          </Button>
          <Link
            href={`/app/approvals?boardId=${encodeURIComponent(boardId)}`}
            className="text-signal underline"
          >
            Review board suggestions
          </Link>
        </div>
        <p role="status" className="text-xs text-fg-muted">
          {message}
        </p>
        {matches.length ? (
          <ul className="space-y-2">
            {matches.map((match) => (
              <li key={match.id}>
                <Link href={`/app/objects/${match.id}`} className="underline">
                  {match.name}
                </Link>{' '}
                — {LABELS[match.decision]}
                <p className="text-xs text-fg-muted">{match.reason}</p>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </details>
  );
}
