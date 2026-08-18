'use client';

import { useLayoutEffect, type ReactNode } from 'react';

import { installJobsPreviewMocks } from '@/components/job-recovery/jobs-preview-mocks';

export function JobsPreviewShell({
  children,
  olderCount,
}: {
  children: ReactNode;
  olderCount: number;
}) {
  useLayoutEffect(() => {
    return installJobsPreviewMocks({ olderCount });
  }, [olderCount]);

  return children;
}
