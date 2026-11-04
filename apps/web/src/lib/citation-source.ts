import type { ArtifactKind } from '@timeline/shared/citation';

const CONNECTOR_ASSETS = new Set([
  'asana',
  'attio',
  'basecamp',
  'bitbucket',
  'close',
  'confluence',
  'datadog',
  'discord',
  'email',
  'figma',
  'github',
  'gitlab',
  'gmail',
  'google-drive',
  'google-meet',
  'hubspot',
  'intercom',
  'jira',
  'linear',
  'microsoft-teams',
  'monday',
  'notion',
  'pipedrive',
  'salesforce',
  'sentry',
  'slack',
  'stripe',
  'telegram',
  'trello',
  'zendesk',
  'zoom',
]);

const MEETING_LOGO: Record<string, string> = {
  meet: 'google-meet',
  google_meet: 'google-meet',
  'google-meet': 'google-meet',
  zoom: 'zoom',
  teams: 'microsoft-teams',
  microsoft_teams: 'microsoft-teams',
  'microsoft-teams': 'microsoft-teams',
};

const PROVIDER_LABEL: Record<string, string> = {
  asana: 'Asana',
  attio: 'Attio',
  basecamp: 'Basecamp',
  bitbucket: 'Bitbucket',
  close: 'Close',
  confluence: 'Confluence',
  datadog: 'Datadog',
  discord: 'Discord',
  email: 'Email',
  figma: 'Figma',
  github: 'GitHub',
  gitlab: 'GitLab',
  gmail: 'Gmail',
  'google-drive': 'Google Drive',
  google_drive: 'Google Drive',
  'google-meet': 'Google Meet',
  google_meet: 'Google Meet',
  hubspot: 'HubSpot',
  intercom: 'Intercom',
  jira: 'Jira',
  linear: 'Linear',
  'microsoft-teams': 'Microsoft Teams',
  microsoft_teams: 'Microsoft Teams',
  monday: 'Monday.com',
  monday_com: 'Monday.com',
  notion: 'Notion',
  pipedrive: 'Pipedrive',
  salesforce: 'Salesforce',
  sentry: 'Sentry',
  slack: 'Slack',
  stripe: 'Stripe',
  telegram: 'Telegram',
  trello: 'Trello',
  zendesk: 'Zendesk',
  zoom: 'Zoom',
};

const SOURCE_LABEL: Record<string, string> = {
  calendar: 'Calendar',
  calendar_event: 'Calendar',
  document: 'Document',
  document_chunk: 'Document',
  email: 'Email',
  ingest_webhook: 'Webhook',
  meeting: 'Call',
  slack: 'Slack',
  telegram: 'Telegram',
  web: 'Note',
};

function normalize(value: string | null | undefined): string | null {
  const text = value?.trim().toLowerCase();
  return text ? text.replaceAll(/\s+/g, '_') : null;
}

function stringMeta(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function nestedMeta(metadata: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = metadata[key];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function titleCase(value: string): string {
  return value
    .replaceAll(/[_-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function providerId(metadata: Record<string, unknown>, source?: string | null): string | null {
  return (
    normalize(stringMeta(metadata, 'provider')) ??
    normalize(stringMeta(metadata, 'integration_provider')) ??
    (source === 'integration' ? null : normalize(source))
  );
}

function connectorSrc(id: string | null | undefined): string | null {
  if (!id) return null;
  const file = id.replaceAll('_', '-');
  return CONNECTOR_ASSETS.has(file) ? `/connectors/${file}.svg` : null;
}

export function citationSourceLabel(input: {
  kind: ArtifactKind;
  source?: string | null;
  metadata?: Record<string, unknown>;
  fallback?: string;
}): string {
  const metadata = input.metadata ?? {};
  const source = normalize(input.source);
  const provider = providerId(metadata, source);
  const platform = normalize(stringMeta(metadata, 'platform'));
  if (provider && PROVIDER_LABEL[provider]) return PROVIDER_LABEL[provider];
  if (source === 'meeting' || input.kind === 'calendar_event') {
    const meeting = MEETING_LOGO[platform ?? ''] ?? (source === 'meeting' ? 'google-meet' : null);
    if (meeting && PROVIDER_LABEL[meeting]) return PROVIDER_LABEL[meeting];
    return 'Call';
  }
  if (provider) return titleCase(provider);
  if (source && SOURCE_LABEL[source]) return SOURCE_LABEL[source];
  if (source) return titleCase(source);
  if (input.fallback?.trim()) return input.fallback.trim();
  return SOURCE_LABEL[input.kind] ?? 'Source';
}

export function citationAuthorHint(metadata: Record<string, unknown> = {}): string | null {
  const github = nestedMeta(metadata, 'github');
  return (
    stringMeta(github, 'repo') ??
    stringMeta(github, 'actor') ??
    stringMeta(metadata, 'title') ??
    stringMeta(nestedMeta(metadata, 'linear'), 'identifier') ??
    null
  );
}

export function citationLogoSrc(input: {
  kind: ArtifactKind;
  source?: string | null;
  metadata?: Record<string, unknown>;
}): string | null {
  const metadata = input.metadata ?? {};
  const source = normalize(input.source);
  const provider = providerId(metadata, source);
  const platform = normalize(stringMeta(metadata, 'platform'));

  if (source === 'slack' || provider === 'slack') return connectorSrc('slack');
  if (source === 'email' || provider === 'email' || provider === 'gmail') {
    return connectorSrc(provider === 'gmail' ? 'gmail' : 'email');
  }
  if (source === 'telegram' || provider === 'telegram') return connectorSrc('telegram');
  if (source === 'meeting' || input.kind === 'calendar_event') {
    return connectorSrc(
      MEETING_LOGO[platform ?? ''] ?? (source === 'meeting' ? 'google-meet' : null),
    );
  }
  if (source === 'document' || input.kind === 'document_chunk') {
    return connectorSrc(
      provider === 'google_drive' || provider === 'google-drive' ? 'google-drive' : null,
    );
  }

  return connectorSrc(provider) ?? connectorSrc(source);
}
