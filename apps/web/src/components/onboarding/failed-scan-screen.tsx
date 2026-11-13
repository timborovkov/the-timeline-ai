'use client';

import {
  scanFailureCopy,
  type FirstRunScanFailureReason,
} from '@timeline/shared/onboarding/first-run';

import { Button } from '@/components/ui/button';

export function FailedScanScreen({
  host,
  reason,
  onUpload,
  onEmail,
  onBack,
}: {
  host: string | null;
  reason: FirstRunScanFailureReason | null;
  onUpload: () => void;
  onEmail: () => void;
  onBack: () => void;
}) {
  const copy = scanFailureCopy({ host, reason });
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">{copy.title}</h1>
      <p className="mt-2 text-sm leading-6 text-fg-muted">{copy.body}</p>
      <p className="mt-5 text-sm font-medium">Try another source</p>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <Button type="button" onClick={onUpload}>
          Upload a deck or document
        </Button>
        <Button type="button" variant="outline" onClick={onEmail}>
          Forward an email
        </Button>
      </div>
      <div className="mt-3">
        <Button type="button" variant="ghost" onClick={onBack}>
          Try another address
        </Button>
      </div>
    </div>
  );
}
