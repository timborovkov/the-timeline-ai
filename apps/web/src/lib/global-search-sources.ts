export const GLOBAL_SEARCH_SOURCE_VALUES = [
  'web',
  'telegram',
  'slack',
  'email',
  'document',
  'meeting',
  'integration',
  'ingest_webhook',
  'calendar',
  'system',
] as const;

export type GlobalSearchSource = (typeof GLOBAL_SEARCH_SOURCE_VALUES)[number];

export const GLOBAL_SEARCH_SOURCE_OPTIONS = [
  { value: 'web', label: 'Web' },
  { value: 'telegram', label: 'Telegram' },
  { value: 'slack', label: 'Slack' },
  { value: 'email', label: 'Email' },
  { value: 'document', label: 'Document' },
  { value: 'meeting', label: 'Meeting' },
  { value: 'integration', label: 'Integration' },
  { value: 'ingest_webhook', label: 'Ingest webhook' },
  { value: 'calendar', label: 'Calendar' },
  { value: 'system', label: 'System' },
] as const satisfies readonly { value: GlobalSearchSource; label: string }[];
