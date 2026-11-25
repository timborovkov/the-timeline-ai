'use client';

import { formatDigestTaskDetail, type DailyDigestPayload } from '@timeline/shared/messaging/format';

import { useRegionalFormat } from '@/components/workspace-timezone-context';

export function DigestTaskDetail({
  task,
  timezone,
  now,
}: {
  task: DailyDigestPayload['tasks'][number];
  timezone?: string;
  now: Date;
}) {
  const { locale } = useRegionalFormat();
  return formatDigestTaskDetail(task, timezone, now, locale);
}
