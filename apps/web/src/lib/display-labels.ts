type DisplayRecord = Record<string, unknown>;

const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

const PROVIDER_LABELS: Record<string, string> = {
  calendar: 'Calendar',
  document: 'Documents',
  email: 'Email',
  github: 'GitHub',
  google_calendar: 'Google Calendar',
  google_drive: 'Google Drive',
  google_meet: 'Google Meet',
  meet: 'Google Meet',
  ingest_webhook: 'Webhook',
  integration: 'Integrations',
  linear: 'Linear',
  meeting: 'Meetings',
  monday: 'Monday.com',
  microsoft_teams: 'Microsoft Teams',
  teams: 'Microsoft Teams',
  recall: 'Recall.ai',
  sentry: 'Sentry',
  slack: 'Slack',
  telegram: 'Telegram',
  system: 'System',
  web: 'Web capture',
  webhook: 'Webhook',
  zoom: 'Zoom',
};

function readable(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (!normalized || UUID_PATTERN.test(normalized)) return undefined;
  return normalized;
}

function value(record: object | null | undefined, keys: string[]): string | undefined {
  if (!record) return undefined;
  const fields = record as DisplayRecord;
  for (const key of keys) {
    const candidate = readable(fields[key]);
    if (candidate) return candidate;
  }
  return undefined;
}

export function isInternalIdentifier(valueToCheck: unknown): boolean {
  return typeof valueToCheck === 'string' && UUID_PATTERN.test(valueToCheck.trim());
}

export function displayMemberLabel(user: object | null | undefined): string {
  return value(user, ['name', 'displayName', 'email']) ?? 'Unknown member';
}

export function displayRemovedMemberLabel(user: object | null | undefined): string {
  return value(user, ['name', 'displayName', 'email']) ?? 'Removed member';
}

export function displayObjectLabel(object: object | null | undefined): string {
  return value(object, ['canonicalName', 'canonical_name', 'name', 'title']) ?? 'Untitled object';
}

export function displayMeetingLabel(meeting: object | null | undefined): string {
  const title = value(meeting, ['title', 'name']);
  if (title && !looksLikeUrl(title)) return title;
  return value(meeting, ['providerDescription', 'domainDescription']) ?? 'Untitled meeting';
}

function looksLikeUrl(valueToCheck: string): boolean {
  return /^(?:https?:\/\/|www\.|[a-z0-9.-]+\.[a-z]{2,}(?:[/:?#]|$))/i.test(valueToCheck.trim());
}

export function displaySourceLabel(source: object | string | null | undefined): string {
  if (typeof source === 'string') {
    const key = source.trim().toLowerCase();
    return PROVIDER_LABELS[key] ?? 'Unavailable source';
  }
  const provider = value(source, ['provider', 'sourceType', 'source_type', 'kind']);
  const providerLabel = provider ? PROVIDER_LABELS[provider.toLowerCase()] : undefined;
  if (providerLabel) return providerLabel;
  return value(source, ['label', 'name', 'title']) ?? 'Unavailable source';
}

export function displayArtifactLabel(artifact: object | null | undefined): string {
  const label = value(artifact, ['canonicalName', 'canonical_name', 'name', 'title', 'filename']);
  if (label) return label;
  const kind = value(artifact, ['artifactType', 'artifact_type', 'type', 'kind']);
  if (!kind) return 'Untitled artifact';
  return `Untitled ${kind.replaceAll('_', ' ').toLowerCase()}`;
}
