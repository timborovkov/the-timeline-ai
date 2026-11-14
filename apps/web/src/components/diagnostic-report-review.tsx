'use client';
import { useState, useTransition } from 'react';

import { readDiagnosticAction } from '@/app/actions/diagnostics';
import { Button } from '@/components/ui/button';

export function DiagnosticReportReview({ id }: { id: string }) {
  const [result, setResult] = useState<Awaited<ReturnType<typeof readDiagnosticAction>> | null>(
    null,
  );
  const [pending, startTransition] = useTransition();
  return (
    <div className="space-y-3">
      <Button
        variant="outline"
        disabled={pending}
        onClick={() => {
          startTransition(async () => {
            try {
              setResult(await readDiagnosticAction(id));
            } catch {
              setResult({ error: 'Could not open report.' });
            }
          });
        }}
      >
        Review submitted report (access is audited)
      </Button>
      {result?.error && <p role="alert">{result.error}</p>}
      {result?.report && (
        <section className="space-y-3">
          <h3 className="font-semibold">Reported issue</h3>
          <p className="whitespace-pre-wrap break-words">{result.report.description}</p>
          <h3 className="font-semibold">Submitted conversation</h3>
          <p className="whitespace-pre-wrap break-words">{result.report.conversation}</p>
          <Button
            variant="ghost"
            onClick={() => {
              setResult(null);
            }}
          >
            Close report
          </Button>
        </section>
      )}
    </div>
  );
}
