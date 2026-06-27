export const OBJECT_TYPES = [
  'person',
  'company',
  'project',
  'topic',
  'other',
  'deal',
  'vendor',
  'incident',
  'document',
  'decision',
  'hiring_loop',
  'task',
  'follow_up',
] as const;

export type ObjectType = (typeof OBJECT_TYPES)[number];
export type ActorKind = 'user' | 'agent' | 'system';

export interface ObjectListFilter {
  id?: string | string[];
  type?: ObjectType | ObjectType[];
  status?: string | string[];
  statusNot?: string | string[];
  stage?: string | string[];
  ownerUserId?: string | null;
  assigneeUserId?: string | null;
  dueBefore?: Date;
  dueAfter?: Date;
  archived?: boolean;
  order?: 'updated' | 'due';
  limit?: number;
  offset?: number;
  cursor?: string | null;
}

export interface ObjectSearchFilter extends Omit<ObjectListFilter, 'cursor' | 'offset'> {
  query: string;
}

export interface ObjectRow {
  id: string;
  type: ObjectType;
  canonicalName: string;
  status: string;
  stage: string | null;
  priority: number | null;
  ownerUserId: string | null;
  assigneeUserId: string | null;
  dueAt: Date | null;
  agentSuggested: boolean;
  archivedAt: Date | null;
  aliases: string[];
  metadata: Record<string, unknown>;
  updatedAt: Date;
  createdAt: Date;
}

function metadataString(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text || null;
}

export function displayObjectTitle(row: Pick<ObjectRow, 'canonicalName' | 'metadata'>): string {
  const explicit = metadataString(row.metadata, 'display_title');
  const explicitSource = metadataString(row.metadata, 'display_title_canonical_name');
  if (explicit && explicitSource && row.canonicalName === explicitSource) return explicit;

  return row.canonicalName;
}

export interface ObjectPatch {
  canonicalName?: string;
  status?: string;
  stage?: string | null;
  priority?: number | null;
  ownerUserId?: string | null;
  assigneeUserId?: string | null;
  dueAt?: Date | null;
  aliases?: string[];
  metadata?: Record<string, unknown>;
  archivedAt?: Date | null;
  type?: ObjectType;
}

export type ObjectSummarySourceRef =
  | { kind: 'field'; id: string }
  | { kind: 'fact'; id: string }
  | { kind: 'timeline_event'; id: string }
  | { kind: 'object_note'; id: string }
  | { kind: 'relationship'; id: string }
  | { kind: 'task'; id: string }
  | { kind: 'object_change'; id: string };

export interface ObjectSummaryView {
  status: 'missing' | 'pending' | 'ready' | 'stale' | 'failed';
  summary: {
    overview: string;
    overviewSourceRefs: ObjectSummarySourceRef[];
    currentState: ObjectSummaryClaim[];
    openQuestions: ObjectSummaryClaim[];
    conflicts: ObjectSummaryClaim[];
  } | null;
  plainText: string;
  sourceRefs: ObjectSummarySourceRef[];
  sourceCounts: ObjectSummarySourceCounts;
  generatedAt: Date | null;
  staleAt: Date | null;
  lastAttemptedAt: Date | null;
  lastErrorCode: string | null;
  canGenerate: boolean;
  cannotGenerateReason: string | null;
}

export interface ObjectSummaryClaim {
  label: string;
  text: string;
  sourceRefs: ObjectSummarySourceRef[];
}

export interface ObjectSummarySourceCounts {
  fields: number;
  facts: number;
  events: number;
  notes: number;
  relationships: number;
  tasks: number;
  changes: number;
}

export interface ObjectDetail extends ObjectRow {
  notes: {
    id: string;
    body: string;
    authorUserId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }[];
  relationships: {
    id: string;
    direction: 'out' | 'in';
    kind: string;
    otherId: string;
    otherName: string;
    otherType: ObjectType;
  }[];
  recentChanges: {
    id: string;
    field: string;
    actorKind: ActorKind;
    actorUserId: string | null;
    previousValue: unknown;
    newValue: unknown;
    status: 'applied' | 'suggested' | 'rejected';
    note: string | null;
    changedAt: Date;
  }[];
  openTasks: ObjectRow[];
  connectedWork: {
    openTasks: ObjectRow[];
    recentTasks: ObjectRow[];
    calendarEvents: {
      id: string;
      title: string;
      startAt: Date;
      endAt: Date;
      showAs: string;
    }[];
    timelineEvents: {
      id: string;
      source: string;
      contentText: string | null;
      occurredAt: Date;
    }[];
    objects: {
      id: string;
      canonicalName: string;
      type: ObjectType;
      factCount: number;
    }[];
    boards: {
      boardId: string;
      boardName: string;
      itemId: string;
      laneName: string | null;
      dueAt: Date | null;
      priority: number | null;
      nextStep: string | null;
    }[];
    pendingApprovals: {
      suggestionId: string;
      itemId: string;
      title: string;
      operation: string;
      targetKind: string;
      createdAt: Date;
    }[];
    documents: {
      id: string;
      name: string;
      fileKind: string;
      updatedAt: Date;
    }[];
  };
  provenance: {
    whyThisExists: ObjectProvenanceEntry[];
    whatChangedIt: ObjectProvenanceEntry[];
    relatedEvidence: ObjectProvenanceEntry[];
  };
  summary: ObjectSummaryView | null;
  newSinceLastVisit: number;
  lastVisitedAt: Date | null;
}

export interface ObjectProvenanceEvidence {
  rawEventId: string;
  quote: string | null;
  source: string;
  contentText: string | null;
  occurredAt: Date;
}

export interface ObjectProvenanceEntry {
  id: string;
  title: string;
  reason: string | null;
  operation: string;
  targetKind: string;
  createdAt: Date;
  evidence: ObjectProvenanceEvidence[];
}

export interface ObjectNotePreview {
  id: string;
  body: string;
  authorUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
  object: ObjectRow;
}

export interface ObjectSummarySearchRow {
  entityId: string;
  plainText: string;
  updatedAt: Date;
}

export interface ObjectMergePreview {
  objects: ObjectRow[];
  survivorId: string;
  aliasesToAdd: string[];
  factSamplesByObjectId: Record<
    string,
    {
      id: string;
      statement: string;
      confidence: number;
      rawEventId: string;
      extractedAt: Date;
    }[]
  >;
  counts: {
    facts: number;
    notes: number;
    relationships: number;
    openTasks: number;
  };
  countsBySurvivorId: Record<string, ObjectMergePreview['counts']>;
}

export type ObjectSection = 'events' | 'facts' | 'changes' | 'tasks' | 'relationships';

export interface ObjectSectionPage {
  items: unknown[];
  nextCursor: string | null;
}

export interface ObjectChangeRow {
  id: string;
  entityId: string;
  entityName: string;
  entityType: ObjectType;
  field: string;
  actorKind: ActorKind;
  actorUserId: string | null;
  previousValue: unknown;
  newValue: unknown;
  status: 'applied' | 'suggested' | 'rejected';
  note: string | null;
  changedAt: Date;
}
