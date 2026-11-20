'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import {
  applyFileCorrection,
  requestFileCorrection,
  resumeFileOcr,
} from '@/app/actions/file-extraction';
import { Button } from '@/components/ui/button';
import { notifyAction } from '@/lib/notify';

export function FileExtractionAction({
  id,
  attemptId,
  resume = false,
  retryIndex = false,
}: {
  id: string;
  attemptId?: string;
  resume?: boolean;
  retryIndex?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const label = attemptId
    ? retryIndex
      ? 'Retry indexing'
      : 'Apply extraction'
    : resume
      ? 'Resume OCR'
      : 'Request second extraction';
  return (
    <Button
      variant="outline"
      size="sm"
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await notifyAction({
            id: `file:extract:${id}`,
            loading: 'Saving…',
            success: attemptId ? 'Extraction applied' : 'Extraction queued',
            error: 'Couldn’t update extraction',
            run: () =>
              attemptId
                ? applyFileCorrection(id, attemptId)
                : resume
                  ? resumeFileOcr(id)
                  : requestFileCorrection(id),
          });
          if (attemptId || !result.error) router.refresh();
        })
      }
    >
      {pending ? 'Saving…' : label}
    </Button>
  );
}
