import type * as jobRecovery from '@timeline/shared/job-recovery';

import { formatDisplayDateTime } from '@/lib/display-dates';

type JobRecoveryItem = jobRecovery.JobRecoveryItem;

export function jobRecoveryRowHint(
  item: Pick<JobRecoveryItem, 'artifactId' | 'detectedAt' | 'error' | 'id'>,
  timezone: string,
): string {
  const lines = [
    formatDisplayDateTime(item.detectedAt, { timezone }),
    `Job ID: ${item.id} | Artifact UUID: ${item.artifactId}`,
  ];
  if (item.error) lines.push(item.error);
  return lines.join('\n');
}
