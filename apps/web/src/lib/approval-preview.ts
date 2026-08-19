import { presentDueDate } from '@timeline/shared/time';

import { formatDisplayDateTime } from '@/lib/display-dates';

export interface ApprovalObjectSnapshot {
  id: string;
  type: string;
  title: string;
  status: string;
  stage: string | null;
  priority: number | null;
  ownerUserId: string | null;
  assigneeUserId: string | null;
  dueAt: string | null;
  aliases: string[];
  content: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface ApprovalCalendarSnapshot {
  id: string;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string;
  timezone: string;
  allDay: boolean;
  location: string | null;
  showAs: string;
  rrule: string | null;
  visibility: string;
  createdAt: string;
  updatedAt: string;
}

export type ApprovalTargetSnapshot =
  | { kind: 'object'; object: ApprovalObjectSnapshot }
  | { kind: 'calendar_event'; event: ApprovalCalendarSnapshot }
  | { kind: 'merge'; objects: ApprovalObjectSnapshot[] }
  | { kind: 'none' };

export interface ApprovalPreviewField {
  key: string;
  label: string;
  current: string | null;
  proposed: string | null;
  changed: boolean;
}

export interface ApprovalPreviewTimestamps {
  createdAt: string | null;
  updatedAt: string | null;
}

const FIELD_LABELS: Record<string, string> = {
  aliases: 'Also known as',
  allDay: 'All day',
  assigneeName: 'Assignee',
  assigneeUserId: 'Assignee',
  boardName: 'Board',
  canonicalName: 'Title',
  content: 'Content',
  description: 'Details',
  dueAt: 'Due',
  endAt: 'Ends',
  entityName: 'Item',
  fromDisplayName: 'From',
  fromName: 'From',
  kind: 'Relationship',
  laneName: 'Lane',
  linkedEntityNames: 'Linked records',
  location: 'Location',
  nextStep: 'Next step',
  notes: 'Notes',
  ownerName: 'Owner',
  ownerUserId: 'Owner',
  parentName: 'Project',
  priority: 'Priority',
  projectName: 'Project',
  reminderMinutes: 'Reminder',
  responsibleName: 'Responsible',
  rrule: 'Recurrence',
  showAs: 'Show as',
  stage: 'Stage',
  startAt: 'Starts',
  status: 'Status',
  survivorName: 'Keep',
  taskCategory: 'Category',
  timezone: 'Time zone',
  title: 'Title',
  toDisplayName: 'To',
  toName: 'To',
  type: 'Type',
  visibility: 'Visibility',
  visibilityUserNames: 'People with access',
};

const OBJECT_FIELD_ORDER = [
  'type',
  'title',
  'status',
  'stage',
  'priority',
  'assigneeUserId',
  'ownerUserId',
  'dueAt',
  'parentName',
  'projectName',
  'taskCategory',
  'aliases',
  'content',
  'description',
  'notes',
  'nextStep',
] as const;

const CALENDAR_FIELD_ORDER = [
  'title',
  'allDay',
  'startAt',
  'endAt',
  'timezone',
  'location',
  'showAs',
  'rrule',
  'visibility',
  'description',
] as const;

const TOKEN_FIELDS = new Set([
  'kind',
  'showAs',
  'stage',
  'status',
  'type',
  'visibility',
  'taskCategory',
]);

function humanizeToken(value: string): string {
  const words = value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
  return words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}` : value;
}

function previewFieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? humanizeToken(key);
}

function formatDue(value: string | null, timezone: string): string {
  const due = presentDueDate(value, { timezone });
  if (due.status === 'invalid') return due.compactText;
  return due.dateLabel ? `${due.label} · ${due.dateLabel}` : due.compactText;
}

function formatValue(
  key: string,
  value: unknown,
  timezone: string,
  members: Record<string, string>,
): string | null {
  if (value === undefined) return null;
  if (value === null) {
    if (key === 'dueAt') return 'No due date';
    if (key === 'assigneeUserId' || key === 'ownerUserId') return 'Unassigned';
    return 'None';
  }
  if (key === 'dueAt' && typeof value === 'string') return formatDue(value, timezone);
  if ((key === 'startAt' || key === 'endAt') && typeof value === 'string') {
    return formatDisplayDateTime(value, { timezone });
  }
  if ((key === 'assigneeUserId' || key === 'ownerUserId') && typeof value === 'string') {
    return members[value] ?? 'Selected team member';
  }
  if (key === 'allDay' && typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (key === 'priority' && typeof value === 'number') return `P${value}`;
  if (TOKEN_FIELDS.has(key) && typeof value === 'string') return humanizeToken(value);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return 'None';
    const joined = value
      .flatMap((entry) =>
        typeof entry === 'string' || typeof entry === 'number' ? [String(entry)] : [],
      )
      .join(', ');
    return joined || 'None';
  }
  return null;
}

function objectCurrentValues(snapshot: ApprovalObjectSnapshot): Record<string, unknown> {
  return {
    type: snapshot.type,
    title: snapshot.title,
    status: snapshot.status,
    stage: snapshot.stage,
    priority: snapshot.priority,
    assigneeUserId: snapshot.assigneeUserId,
    ownerUserId: snapshot.ownerUserId,
    dueAt: snapshot.dueAt,
    aliases: snapshot.aliases,
    content: snapshot.content,
  };
}

function calendarCurrentValues(snapshot: ApprovalCalendarSnapshot): Record<string, unknown> {
  return {
    title: snapshot.title,
    allDay: snapshot.allDay,
    startAt: snapshot.startAt,
    endAt: snapshot.endAt,
    timezone: snapshot.timezone,
    location: snapshot.location,
    showAs: snapshot.showAs,
    rrule: snapshot.rrule,
    visibility: snapshot.visibility,
    description: snapshot.description,
  };
}

function proposedValues(payload: Record<string, unknown>, title: string): Record<string, unknown> {
  const next: Record<string, unknown> = { ...payload };
  if (typeof payload.canonicalName === 'string' && !payload.title)
    next.title = payload.canonicalName;
  next.title ??= title;
  if (typeof payload.createProjectName === 'string' && !payload.projectName) {
    next.projectName = payload.createProjectName;
  }
  return next;
}

function mergeFieldKeys(
  order: readonly string[],
  current: Record<string, unknown>,
  proposed: Record<string, unknown>,
): string[] {
  const skip = new Set([
    'metadata',
    'localRef',
    'fromRef',
    'toRef',
    'objectIds',
    'survivorId',
    'parentId',
    'createProjectName',
    'canonicalName',
    'taskCategoryMode',
    'visibilityUserIds',
    'proposalGroupId',
    'proposalRole',
    'proposalStatus',
    'recurrenceEditMode',
  ]);
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const key of order) {
    if (skip.has(key)) continue;
    if (current[key] !== undefined || proposed[key] !== undefined) {
      keys.push(key);
      seen.add(key);
    }
  }
  for (const key of Object.keys(proposed)) {
    if (skip.has(key) || seen.has(key)) continue;
    if (key.toLowerCase().endsWith('id') || key.toLowerCase().endsWith('ids')) continue;
    keys.push(key);
    seen.add(key);
  }
  return keys;
}

function valuesEqual(left: string | null, right: string | null): boolean {
  return (left ?? '') === (right ?? '');
}

export function buildApprovalPreviewFields(input: {
  operation: string;
  targetKind: string;
  title: string;
  proposedPayload: Record<string, unknown>;
  snapshot: ApprovalTargetSnapshot | null;
  members: Record<string, string>;
  timezone: string;
}): { fields: ApprovalPreviewField[]; timestamps: ApprovalPreviewTimestamps } {
  const proposed = proposedValues(input.proposedPayload, input.title);
  const objectSnapshot = input.snapshot?.kind === 'object' ? input.snapshot.object : null;
  const calendarSnapshot = input.snapshot?.kind === 'calendar_event' ? input.snapshot.event : null;
  const current =
    objectSnapshot !== null
      ? objectCurrentValues(objectSnapshot)
      : calendarSnapshot !== null
        ? calendarCurrentValues(calendarSnapshot)
        : {};
  const order =
    input.targetKind === 'calendar_event' || calendarSnapshot
      ? CALENDAR_FIELD_ORDER
      : OBJECT_FIELD_ORDER;
  const isCreate =
    input.operation === 'create' || input.snapshot?.kind === 'none' || !input.snapshot;
  const fields = mergeFieldKeys(order, current, proposed).flatMap((key) => {
    const currentText = formatValue(key, current[key], input.timezone, input.members);
    const proposedRaw = proposed[key];
    const proposedText =
      proposedRaw === undefined
        ? isCreate
          ? currentText
          : null
        : formatValue(key, proposedRaw, input.timezone, input.members);
    if (!currentText && !proposedText) return [];
    const changed = isCreate
      ? Boolean(proposedText)
      : proposedRaw !== undefined && !valuesEqual(currentText, proposedText);
    return [
      {
        key,
        label: previewFieldLabel(key),
        current: currentText,
        proposed: proposedRaw === undefined && !isCreate ? currentText : proposedText,
        changed,
      },
    ];
  });

  if (input.snapshot?.kind === 'merge') {
    fields.unshift({
      key: 'records',
      label: 'Records',
      current: input.snapshot.objects.map((row) => row.title).join(', ') || null,
      proposed: input.snapshot.objects.map((row) => row.title).join(', ') || null,
      changed: false,
    });
  }

  const timestamps: ApprovalPreviewTimestamps = {
    createdAt: objectSnapshot?.createdAt ?? calendarSnapshot?.createdAt ?? null,
    updatedAt: objectSnapshot?.updatedAt ?? calendarSnapshot?.updatedAt ?? null,
  };
  return { fields, timestamps };
}
