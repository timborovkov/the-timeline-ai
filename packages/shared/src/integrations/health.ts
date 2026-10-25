export const INTEGRATION_HEALTH_PAUSE_KINDS = [
  'access_revoked',
  'connectivity',
  'auth',
  'permanent',
] as const;

export type IntegrationHealthPauseKind = (typeof INTEGRATION_HEALTH_PAUSE_KINDS)[number];

export const DEFAULT_INTEGRATION_HEALTH_PAUSE_AFTER_HOURS = 72;
export const INTEGRATION_HEALTH_PAUSE_MIN_FAILURES = 2;

const HEALTH_KIND_RANK: Record<IntegrationHealthPauseKind, number> = {
  connectivity: 1,
  permanent: 2,
  auth: 3,
  access_revoked: 4,
};

export type IntegrationHealthClassification =
  | { counted: true; kind: IntegrationHealthPauseKind }
  | { counted: false; reason: 'rate_limited' | 'transient' };

const RATE_LIMIT_RE =
  /\b(?:429|github_rate_limited|provider_rate_limited|secondary rate limit|api rate limit exceeded|rate limit(?:ing|ed)?)\b/i;
const ACCESS_REVOKED_RE =
  /\b(?:401|403|404)\b|bad credentials|resource not accessible|not found|removed installation|installation (?:was )?deleted|access (?:was )?revoked|repository not found|bad_credentials/i;
const CONNECTIVITY_RE =
  /\b(?:ECONNREFUSED|ETIMEDOUT|ENETUNREACH|EAI_AGAIN|ENOTFOUND|ECONNRESET|UND_ERR|UND_ERR_CONNECT_TIMEOUT|network_failure|socket hang up|connect timeout|fetch failed)\b/i;
const AUTH_RE =
  /\b(?:reconnect|expired|unauthorized|forbidden|invalid_grant|invalid_token|no tokens)\b/i;
const PERMANENT_RE =
  /\b(?:410|451)\b|permanently(?:\s+\w+)?(?:\s+deleted)?|account suspended|application has been blocked|this app has been blocked/i;
const TRANSIENT_RE = /\b(?:408|500|502|503|504|temporarily overloaded|try again later)\b/i;

const PROVIDER_LABELS: Record<string, string> = {
  google_drive: 'Google Drive',
  linear: 'Linear',
  github: 'GitHub',
  monday: 'Monday.com',
  slack: 'Slack',
  sentry: 'Sentry',
};

export function isIntegrationHealthPauseKind(
  value: string | null | undefined,
): value is IntegrationHealthPauseKind {
  return (INTEGRATION_HEALTH_PAUSE_KINDS as readonly string[]).includes(value ?? '');
}

export function integrationHealthProviderLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

export function classifyIntegrationHealthFailure(message: string): IntegrationHealthClassification {
  if (RATE_LIMIT_RE.test(message)) return { counted: false, reason: 'rate_limited' };
  if (ACCESS_REVOKED_RE.test(message)) return { counted: true, kind: 'access_revoked' };
  if (CONNECTIVITY_RE.test(message)) return { counted: true, kind: 'connectivity' };
  if (AUTH_RE.test(message)) return { counted: true, kind: 'auth' };
  if (PERMANENT_RE.test(message)) return { counted: true, kind: 'permanent' };
  if (TRANSIENT_RE.test(message)) return { counted: false, reason: 'transient' };
  return { counted: false, reason: 'transient' };
}

export function highestCountedHealthKind(
  messages: readonly string[],
): IntegrationHealthPauseKind | null {
  let winner: IntegrationHealthPauseKind | null = null;
  let rank = 0;
  for (const message of messages) {
    const classified = classifyIntegrationHealthFailure(message);
    if (!classified.counted) continue;
    const nextRank = HEALTH_KIND_RANK[classified.kind];
    if (nextRank > rank) {
      winner = classified.kind;
      rank = nextRank;
    }
  }
  return winner;
}

export function attentionCategoryForHealthKind(
  kind: IntegrationHealthPauseKind,
): 'access_revoked' | 'needs_reconnect' | null {
  if (kind === 'access_revoked') return 'access_revoked';
  if (kind === 'auth') return 'needs_reconnect';
  return null;
}

export function formatHealthPauseDuration(from: Date, to = new Date()): string {
  const hours = Math.max(1, Math.round(Math.max(0, to.getTime() - from.getTime()) / 3_600_000));
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

export function formatHealthPauseNotice(input: {
  provider: string;
  kind: IntegrationHealthPauseKind;
  firstFailedAt?: Date | string | null;
  now?: Date;
  providerLabel?: string;
}): string {
  const label = input.providerLabel ?? integrationHealthProviderLabel(input.provider);
  if (input.kind === 'access_revoked') return `Paused: ${label} access was revoked.`;
  if (input.kind === 'auth') return `Paused: ${label} needs to be reconnected.`;
  if (input.kind === 'permanent') return `Paused: ${label} returned a permanent error.`;
  const from =
    input.firstFailedAt instanceof Date
      ? input.firstFailedAt
      : typeof input.firstFailedAt === 'string'
        ? new Date(input.firstFailedAt)
        : null;
  const duration =
    from && !Number.isNaN(from.getTime())
      ? formatHealthPauseDuration(from, input.now ?? new Date())
      : '3 days';
  return `Paused: ${label} hasn't responded for ${duration}.`;
}

export function healthPauseAction(kind: IntegrationHealthPauseKind): {
  action: 'reconnect' | 'resume';
  href?: string;
  label: string;
} {
  if (kind === 'access_revoked' || kind === 'auth') {
    return { action: 'reconnect', href: '/app/me/connections', label: 'Reconnect' };
  }
  return { action: 'resume', label: 'Resume' };
}

export function integrationHealthPauseAfterMs(
  hours = DEFAULT_INTEGRATION_HEALTH_PAUSE_AFTER_HOURS,
): number {
  return Math.max(1, hours) * 60 * 60 * 1000;
}
