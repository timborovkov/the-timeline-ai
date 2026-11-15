import {
  EVALUATION_CONSENT_VERSION,
  EVALUATION_SOURCES,
} from '@timeline/shared/evaluation-tracing/contract';

export function evaluationSharingStatus(
  preference: { enabled: boolean; sources: string[]; policyVersion: string },
  available: boolean,
  inactive: boolean,
) {
  if (!preference.enabled) return 'Off';
  if (inactive) return 'Paused — workspace inactive';
  if (preference.policyVersion !== EVALUATION_CONSENT_VERSION) return 'Needs renewed consent';
  if (
    !preference.sources.some((source) => EVALUATION_SOURCES.some((allowed) => source === allowed))
  )
    return 'No eligible sources selected';
  if (!available) return 'Opted in — configuration pending';
  return 'Opted in — eligible for sampling';
}
