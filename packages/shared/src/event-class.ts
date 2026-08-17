/**
 * Presentation and promotion family for captured timeline events.
 *
 * Native sources, provider integrations, and generic ingest webhooks all
 * resolve to one of these classes. The class decides visual weight, whether
 * `objectMap` may feed artifact identity, and how the inspector is laid out.
 * Provider-specific formatters stay elsewhere; this module is the extensible
 * seam for GitLab, PostHog, CRM webhooks, and anything else that lands later.
 *
 * Writers stamp `source_metadata.event_class` at ingest. Presentation reads
 * that stamp first, then infers from nested record types and event-type
 * patterns so older rows still classify.
 */

export const TIMELINE_EVENT_CLASSES = [
  'communication',
  'work_record',
  'pulse',
  'incident',
  'artifact',
  'schedule',
] as const;

export type TimelineEventClass = (typeof TIMELINE_EVENT_CLASSES)[number];

export type TimelineVisualWeight = 'story' | 'record' | 'pulse';

export const TIMELINE_EVENT_CLASS_OPTIONS: {
  value: TimelineEventClass;
  label: string;
  hint: string;
}[] = [
  {
    value: 'pulse',
    label: 'Status pulse',
    hint: 'CI, deploys, telemetry, and other compact status changes. Default for unknown webhooks.',
  },
  {
    value: 'work_record',
    label: 'Work record',
    hint: 'A named record that changed: pull request, issue, deal, ticket, or CRM object.',
  },
  {
    value: 'communication',
    label: 'Conversation',
    hint: 'Messages, comments, and other human discussion.',
  },
  {
    value: 'incident',
    label: 'Incident',
    hint: 'A durable error or outage record, not each individual ping.',
  },
  {
    value: 'artifact',
    label: 'Document',
    hint: 'Files, pages, and other artifacts.',
  },
  {
    value: 'schedule',
    label: 'Schedule',
    hint: 'Calendar events and other time-bound records.',
  },
];

const EVENT_CLASS_SET = new Set<string>(TIMELINE_EVENT_CLASSES);

const SOURCE_CLASS: Record<string, TimelineEventClass> = {
  telegram: 'communication',
  slack: 'communication',
  email: 'communication',
  web: 'communication',
  meeting: 'communication',
  document: 'artifact',
  calendar: 'schedule',
  system: 'pulse',
  ingest_webhook: 'pulse',
};

const NESTED_TYPE_CLASS: Record<string, TimelineEventClass> = {
  workflow_run: 'pulse',
  check_run: 'pulse',
  check_suite: 'pulse',
  pipeline: 'pulse',
  commit: 'pulse',
  pull_request: 'work_record',
  merge_request: 'work_record',
  issue: 'work_record',
  review: 'work_record',
  release: 'work_record',
  project: 'work_record',
  deal: 'work_record',
  opportunity: 'work_record',
  contact: 'work_record',
  company: 'work_record',
  ticket: 'work_record',
  document: 'artifact',
  file: 'artifact',
  page: 'artifact',
  incident: 'incident',
};

const EVENT_TYPE_RULES: { pattern: RegExp; eventClass: TimelineEventClass }[] = [
  {
    pattern: /workflow_run|check_run|check_suite|pipeline|build\.(queued|in_progress|completed)/i,
    eventClass: 'pulse',
  },
  {
    pattern: /^(job|run)\.(queued|in_progress|completed|requested)/i,
    eventClass: 'pulse',
  },
  {
    pattern: /commit\.|push\.|ping$|heartbeat|occurrence|event\.created|metric\./i,
    eventClass: 'pulse',
  },
  {
    pattern: /incident|issue\.(resolved|unresolved|ignored|regressed)|alert\.(triggered|resolved)/i,
    eventClass: 'incident',
  },
  {
    pattern: /pull_request|merge_request|(^|\.)pr\.(opened|closed|merged|updated|review)/i,
    eventClass: 'work_record',
  },
  {
    pattern: /^(issue|ticket|task|deal|opportunity|contact|company|lead|item|project)\./i,
    eventClass: 'work_record',
  },
  { pattern: /release\.|deployment\.|deploy\./i, eventClass: 'work_record' },
  { pattern: /comment\.|message\.|chat\./i, eventClass: 'communication' },
  { pattern: /document\.|file\.|drive\./i, eventClass: 'artifact' },
  { pattern: /calendar\.|meeting\./i, eventClass: 'schedule' },
];

export function isTimelineEventClass(value: unknown): value is TimelineEventClass {
  return typeof value === 'string' && EVENT_CLASS_SET.has(value);
}

export function classifyCapturedEvent(input: {
  source: string;
  metadata?: unknown;
}): TimelineEventClass {
  const metadata = recordValue(input.metadata);
  const stamped = isTimelineEventClass(metadata?.event_class) ? metadata.event_class : null;
  if (stamped) return stamped;

  const inferred = inferIntegrationClass(metadata) ?? SOURCE_CLASS[input.source];
  return inferred ?? 'pulse';
}

export function visualWeightForEventClass(
  eventClass: TimelineEventClass,
  groupingMode: 'moments' | 'events' = 'moments',
): TimelineVisualWeight {
  if (groupingMode === 'events') return 'pulse';
  if (eventClass === 'communication') return 'story';
  if (eventClass === 'pulse') return 'pulse';
  return 'record';
}

export function promotesWorkspaceObject(eventClass: TimelineEventClass): boolean {
  return eventClass === 'work_record' || eventClass === 'incident' || eventClass === 'artifact';
}

export function isMachineIdentityLabel(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)) {
    return true;
  }
  if (/(?:^|[#/])(?:workflow_run|check_run|check_suite|pipeline|job|run):\d+/i.test(trimmed)) {
    return true;
  }
  if (/^\d{9,}$/.test(trimmed)) return true;
  if (/^[0-9a-f]{20,}$/i.test(trimmed)) return true;
  return false;
}

function inferIntegrationClass(
  metadata: Record<string, unknown> | null,
): TimelineEventClass | null {
  if (!metadata) return null;

  const nestedType = nestedRecordType(metadata);
  if (nestedType) {
    const mapped = NESTED_TYPE_CLASS[nestedType];
    if (mapped) return mapped;
  }

  const eventType = stringValue(metadata.event_type) ?? stringValue(metadata.event);
  if (eventType) {
    for (const rule of EVENT_TYPE_RULES) {
      if (rule.pattern.test(eventType)) return rule.eventClass;
    }
  }

  if (stringValue(metadata.sentry_issue_id) && !stringValue(metadata.sentry_event_id)) {
    return 'incident';
  }
  if (stringValue(metadata.monday_item_name) || stringValue(metadata.monday_parent_item_name)) {
    return 'work_record';
  }
  const linear = recordValue(metadata.linear);
  if (linear && (stringValue(linear.kind) === 'issue' || stringValue(linear.identifier))) {
    return 'work_record';
  }

  return null;
}

function nestedRecordType(metadata: Record<string, unknown>): string | null {
  const direct =
    stringValue(metadata.record_kind) ??
    stringValue(metadata.sentry_record_kind) ??
    stringValue(metadata.linear_record_kind) ??
    stringValue(metadata.monday_record_kind);
  if (direct) return direct;

  for (const value of Object.values(metadata)) {
    const nested = recordValue(value);
    if (!nested) continue;
    const type = stringValue(nested.type) ?? stringValue(nested.kind);
    if (type && NESTED_TYPE_CLASS[type]) return type;
  }
  return null;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
