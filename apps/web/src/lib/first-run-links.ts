import type { FirstRunState } from '@timeline/shared/onboarding/first-run';

export function firstRunCaptureUnavailable(
  firstRun: FirstRunState | null,
  record: { sources: readonly unknown[] } | null,
): boolean {
  return Boolean(firstRun?.firstCaptureLandedAt && !record?.sources.length);
}

export function firstRunCaptureKey(firstRun: FirstRunState | null): string | null {
  if (
    !firstRun?.starterPath ||
    firstRun.starterPath === 'skip' ||
    firstRun.phase === 'welcome' ||
    firstRun.phase === 'choose'
  ) {
    return null;
  }
  const selectedAt = firstRun.starterSelectedAt ?? firstRun.createdAt;
  return [firstRun.teamId, firstRun.starterPath, selectedAt.getTime()].join('.');
}

export function firstRunCaptureHref(
  capture: string,
  destination: 'setup' | 'record' = 'setup',
): string {
  const path = destination === 'record' ? '/app/onboarding/record' : '/onboarding';
  return path + '?capture=' + encodeURIComponent(capture);
}
