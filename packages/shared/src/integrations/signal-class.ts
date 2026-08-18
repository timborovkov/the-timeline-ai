import type { IntegrationEvent, ObjectMapping, SignalClass } from '#src/integrations/types.js';

/** Envelope signal class. Adapters should stamp this; the writer fills gaps. */
export const SIGNAL_CLASSES = ['communication', 'captured_work', 'pulse', 'finding'] as const;

const LEGACY_STRUCTURED_PROVIDERS = new Set(['github', 'linear', 'monday', 'sentry']);
const CAPTURED_WORK_OBJECT_TYPES = new Set(['task', 'follow_up']);
const FINDING_OBJECT_TYPES = new Set(['incident']);
const PULSE_OBJECT_TYPES = new Set(['document']);
const GITHUB_CAPTURED_WORK_TYPES = new Set(['pull_request', 'issue']);
const GITHUB_PULSE_TYPES = new Set(['workflow_run', 'check_run', 'check_suite']);
const GITHUB_FINDING_TYPES = new Set([
  'commit',
  'comment',
  'review',
  'review_comment',
  'issue_comment',
  'discussion',
  'release',
]);

export interface SignalClassInput {
  signalClass?: SignalClass | null | undefined;
  provider?: string | null | undefined;
  eventType?: string | null | undefined;
  extra?: Record<string, unknown> | null | undefined;
  objectMap?: ObjectMapping | null | undefined;
  sourceMetadata?: unknown;
}

export function isSignalClass(value: unknown): value is SignalClass {
  return typeof value === 'string' && (SIGNAL_CLASSES as readonly string[]).includes(value);
}

export function compactObjectMap(
  objectMap: ObjectMapping | null | undefined,
): ObjectMapping | null {
  if (!objectMap) return null;
  return {
    type: objectMap.type,
    canonicalName: objectMap.canonicalName,
    externalId: objectMap.externalId,
    ...(objectMap.displayTitle ? { displayTitle: objectMap.displayTitle } : {}),
    ...(objectMap.status ? { status: objectMap.status } : {}),
    ...(objectMap.priority !== undefined ? { priority: objectMap.priority } : {}),
    ...(objectMap.url ? { url: objectMap.url } : {}),
    ...(objectMap.aliases && objectMap.aliases.length > 0 ? { aliases: objectMap.aliases } : {}),
  };
}

export function objectMapFromUnknown(value: unknown): ObjectMapping | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const type = typeof record.type === 'string' ? record.type : null;
  const canonicalName = typeof record.canonicalName === 'string' ? record.canonicalName : null;
  const externalId = typeof record.externalId === 'string' ? record.externalId : null;
  if (!type || !canonicalName || !externalId) return null;
  const mapping: ObjectMapping = {
    type: type as ObjectMapping['type'],
    canonicalName,
    externalId,
  };
  if (typeof record.displayTitle === 'string') mapping.displayTitle = record.displayTitle;
  if (
    record.status === 'open' ||
    record.status === 'todo' ||
    record.status === 'in_progress' ||
    record.status === 'done' ||
    record.status === 'cancelled' ||
    record.status === 'suggested' ||
    record.status === 'follow_up'
  ) {
    mapping.status = record.status;
  }
  if (
    record.priority === null ||
    record.priority === 'low' ||
    record.priority === 'medium' ||
    record.priority === 'high' ||
    record.priority === 'urgent'
  ) {
    mapping.priority = record.priority;
  }
  if (typeof record.url === 'string') mapping.url = record.url;
  if (Array.isArray(record.aliases)) {
    mapping.aliases = record.aliases.filter((alias): alias is string => typeof alias === 'string');
  }
  return compactObjectMap(mapping);
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function nestedType(extra: Record<string, unknown>, key: string): string | null {
  const nested = recordFromUnknown(extra[key]);
  const type = nested.type ?? nested.kind;
  return typeof type === 'string' && type.length > 0 ? type : null;
}

function signalClassFromMetadata(sourceMetadata: unknown): SignalClass | null {
  const metadata = recordFromUnknown(sourceMetadata);
  return isSignalClass(metadata.signal_class) ? metadata.signal_class : null;
}

/**
 * Resolve the envelope signal class. Explicit `signalClass` wins, then stored
 * `signal_class`, then objectMap / adapter extra shapes, then a conservative
 * legacy provider fallback so already-ingested rows keep skipping extract.
 */
export function resolveSignalClass(input: SignalClassInput): SignalClass {
  if (isSignalClass(input.signalClass)) return input.signalClass;
  const fromMetadata = signalClassFromMetadata(input.sourceMetadata);
  if (fromMetadata) return fromMetadata;

  const extra = {
    ...recordFromUnknown(input.sourceMetadata),
    ...recordFromUnknown(input.extra),
  };
  const githubType =
    nestedType(extra, 'github') ?? nestedType(recordFromUnknown(extra.github), 'github');
  if (githubType && GITHUB_CAPTURED_WORK_TYPES.has(githubType)) return 'captured_work';
  if (githubType && GITHUB_PULSE_TYPES.has(githubType)) return 'pulse';
  if (githubType && GITHUB_FINDING_TYPES.has(githubType)) return 'finding';

  const linearKind = nestedType(extra, 'linear');
  if (linearKind === 'issue') return 'captured_work';
  if (linearKind === 'comment') return 'finding';
  if (linearKind === 'project') return 'pulse';

  const eventType =
    input.eventType ?? (typeof extra.event_type === 'string' ? extra.event_type : '');
  if (
    eventType.startsWith('workflow_run') ||
    eventType === 'file.changed' ||
    eventType === 'file.removed' ||
    eventType === 'board.schema'
  ) {
    return 'pulse';
  }
  if (
    eventType.includes('comment') ||
    eventType.includes('review') ||
    eventType.startsWith('commit.') ||
    eventType.startsWith('update.')
  ) {
    return 'finding';
  }

  const objectMap =
    input.objectMap ?? objectMapFromUnknown(recordFromUnknown(input.sourceMetadata).object_map);
  if (objectMap && CAPTURED_WORK_OBJECT_TYPES.has(objectMap.type)) return 'captured_work';
  if (objectMap && FINDING_OBJECT_TYPES.has(objectMap.type)) return 'finding';
  if (objectMap && PULSE_OBJECT_TYPES.has(objectMap.type)) return 'pulse';
  if (objectMap?.type === 'other' && objectMap.status) return 'captured_work';
  if (objectMap?.type === 'other') return 'pulse';

  const provider =
    input.provider ??
    (typeof extra.provider === 'string' && extra.provider.length > 0 ? extra.provider : null);
  if (provider === 'google_drive') return 'pulse';
  if (provider && LEGACY_STRUCTURED_PROVIDERS.has(provider)) return 'captured_work';
  return 'communication';
}

export function resolveSignalClassForEvent(event: IntegrationEvent): SignalClass {
  return resolveSignalClass({
    signalClass: event.signalClass,
    provider: event.provider,
    eventType: event.eventType,
    extra: event.extra ?? null,
    objectMap: event.objectMap ?? null,
  });
}

export function extractSkipReasonForSignalClass(signalClass: SignalClass): string | null {
  if (signalClass === 'communication') return null;
  if (signalClass === 'pulse') return 'integration_pulse_source';
  if (signalClass === 'finding') return 'integration_finding_source';
  return 'integration_structured_source';
}
