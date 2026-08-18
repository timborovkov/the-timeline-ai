import { textMentionsAnyValue } from '#src/sql-like.js';

export const WORKSPACE_HUB_TYPES = ['project', 'company', 'vendor', 'deal'] as const;
type WorkspaceHubType = (typeof WORKSPACE_HUB_TYPES)[number];

const ACCOUNT_HUB_TYPES = new Set<string>(['company', 'vendor', 'deal']);
const MIN_FULL_NAME_LENGTH = 3;
const MIN_TOKEN_LENGTH = 4;
const MAX_BUNDLE_ITEMS_AFTER_ATTACH = 6;

const GENERIC_WORK_TOKENS = new Set([
  'book',
  'complete',
  'completed',
  'create',
  'creating',
  'done',
  'file',
  'finish',
  'finished',
  'just',
  'make',
  'making',
  'name',
  'names',
  'naming',
  'page',
  'proposal',
  'select',
  'selection',
  'send',
  'sending',
  'someone',
  'thing',
  'tomorrow',
  'whatever',
  'yeah',
]);

const OPEN_WORK_TYPES = new Set(['task', 'follow_up']);
const CLOSED_WORK_STATUSES = new Set(['done', 'cancelled', 'canceled']);

const GENERIC_HUB_TOKENS = new Set([
  'about',
  'after',
  'agency',
  'and',
  'app',
  'application',
  'audit',
  'board',
  'call',
  'client',
  'company',
  'deal',
  'design',
  'dev',
  'development',
  'for',
  'from',
  'general',
  'group',
  'internal',
  'kickoff',
  'labs',
  'meeting',
  'new',
  'onboarding',
  'our',
  'platform',
  'portal',
  'project',
  'redesign',
  'review',
  'rollout',
  'standup',
  'sync',
  'system',
  'task',
  'team',
  'the',
  'this',
  'update',
  'website',
  'weekly',
  'with',
  'work',
]);

const TITLE_METADATA_KEYS = ['meeting_title', 'title', 'subject'] as const;

/** Envelope keys adapters stamp for conversation/board/repo containers. */
export const CONTAINER_LABEL_METADATA_KEYS = [
  'slack_channel_name',
  'tg_chat_title',
  'monday_board_name',
  'monday_item_board_name',
  'monday_workspace_name',
  'github_repo',
] as const;

export interface WorkspaceHub {
  id: string;
  type: string;
  name: string;
  aliases: string[];
  status: string;
}

export interface QualifiedWorkspaceHubs {
  mentioned: WorkspaceHub[];
  uniqueProject: WorkspaceHub | null;
  uniqueCompany: WorkspaceHub | null;
}

export interface HubAttachableItem {
  operation: string;
  targetKind: string;
  title: string;
  description?: string | null | undefined;
  proposedPayload: Record<string, unknown>;
  targetId?: string | null;
}

export interface HubAttachableBundle<T extends HubAttachableItem = HubAttachableItem> {
  items: T[];
}

function isWorkspaceHubType(type: string): type is WorkspaceHubType {
  return (WORKSPACE_HUB_TYPES as readonly string[]).includes(type);
}

function metadataString(value: unknown, key: string): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = (value as Record<string, unknown>)[key];
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const text = String(raw).trim();
  return text.length > 0 ? text : null;
}

function nestedContainerLabels(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  const labels: string[] = [];
  const github = record.github;
  if (github && typeof github === 'object' && !Array.isArray(github)) {
    const repo = metadataString(github, 'repo');
    if (repo) labels.push(repo);
  }
  const linear = record.linear;
  if (linear && typeof linear === 'object' && !Array.isArray(linear)) {
    const linearRecord = linear as Record<string, unknown>;
    const teamName = metadataString(linearRecord.team, 'name');
    const project = linearRecord.project;
    const projectName =
      typeof project === 'string' ? project.trim() || null : metadataString(project, 'name');
    if (teamName) labels.push(teamName);
    if (projectName) labels.push(projectName);
  }
  return labels;
}

function evidenceLabelsFromMetadata(value: unknown): string[] {
  return [
    ...TITLE_METADATA_KEYS.map((key) => metadataString(value, key)),
    ...CONTAINER_LABEL_METADATA_KEYS.map((key) => metadataString(value, key)),
    ...nestedContainerLabels(value),
  ].filter((text): text is string => typeof text === 'string');
}

export function hubEvidenceText(args: {
  text: string;
  sourceMetadata?: unknown;
  window?: readonly { contentText: string; sourceMetadata?: unknown }[];
  linkedContext?: readonly { contentText: string; sourceMetadata?: unknown }[];
}): string {
  const related = [...(args.window ?? []), ...(args.linkedContext ?? [])];
  const labels = [
    ...evidenceLabelsFromMetadata(args.sourceMetadata),
    ...related.flatMap((event) => [
      event.contentText,
      ...evidenceLabelsFromMetadata(event.sourceMetadata),
    ]),
  ].filter((value) => value.trim().length > 0);
  return [args.text, ...labels].join('\n');
}

export function mentionKeysForHub(hub: Pick<WorkspaceHub, 'name' | 'aliases'>): string[] {
  const labels = [hub.name, ...hub.aliases]
    .map((value) => value.replace(/\s+/g, ' ').trim())
    .filter((value) => value.length >= MIN_FULL_NAME_LENGTH);
  const tokens: string[] = [];
  for (const label of labels) {
    for (const raw of label.match(/[\p{L}\p{N}]+/gu) ?? []) {
      const token = raw.toLocaleLowerCase('en-US');
      if (token.length < MIN_TOKEN_LENGTH) continue;
      if (GENERIC_HUB_TOKENS.has(token)) continue;
      tokens.push(raw);
    }
  }
  return [...new Set([...labels, ...tokens])];
}

export function hubMentionedInText(
  hub: Pick<WorkspaceHub, 'name' | 'aliases'>,
  text: string,
): boolean {
  const keys = mentionKeysForHub(hub);
  return keys.length > 0 && textMentionsAnyValue(text, keys);
}

export function uniqueHubOfType(
  mentioned: readonly WorkspaceHub[],
  type: WorkspaceHubType,
): WorkspaceHub | null {
  const matches = mentioned.filter((hub) => hub.type === type);
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

export function uniqueAccountHub(mentioned: readonly WorkspaceHub[]): WorkspaceHub | null {
  const matches = mentioned.filter((hub) => ACCOUNT_HUB_TYPES.has(hub.type));
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

export function qualifyWorkspaceHubs(args: {
  hubs: readonly WorkspaceHub[];
  text: string;
}): QualifiedWorkspaceHubs {
  const mentioned = args.hubs.filter(
    (hub) => isWorkspaceHubType(hub.type) && hubMentionedInText(hub, args.text),
  );
  return {
    mentioned,
    uniqueProject: uniqueHubOfType(mentioned, 'project'),
    uniqueCompany: uniqueAccountHub(mentioned),
  };
}

export function selectPromptObjects<T extends { id: string }>(args: {
  mentioned: readonly T[];
  related?: readonly T[];
  recent: readonly T[];
  limit: number;
}): T[] {
  const selected: T[] = [];
  const seen = new Set<string>();
  for (const row of [...args.mentioned, ...(args.related ?? []), ...args.recent]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    selected.push(row);
    if (selected.length >= args.limit) break;
  }
  return selected;
}

function extractWorkTokens(value: string): string[] {
  const tokens: string[] = [];
  for (const raw of value.match(/[\p{L}\p{N}]+/gu) ?? []) {
    const token = raw.toLocaleLowerCase('en-US');
    if (token.length < MIN_TOKEN_LENGTH) continue;
    if (GENERIC_HUB_TOKENS.has(token) || GENERIC_WORK_TOKENS.has(token)) continue;
    tokens.push(token);
  }
  return tokens;
}

function workTokensOverlap(left: readonly string[], right: readonly string[]): boolean {
  for (const a of left) {
    for (const b of right) {
      if (a === b) return true;
      const min = Math.min(a.length, b.length);
      if (min >= MIN_TOKEN_LENGTH && (a.startsWith(b) || b.startsWith(a))) return true;
    }
  }
  return false;
}

function aliasStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

const CLOSED_LIFECYCLE_STATUSES = new Set(['done', 'shipped', 'complete', 'completed']);

/**
 * Recall open tasks/follow-ups whose distinctive title tokens overlap the
 * evidence. This fills the suggestion prompt so a week-old branding task can
 * be updated to done when later captures show the deliverable. It is not a
 * write join: two overlaps stay listed, and qualify strips a guessed `done`.
 */
export function recallRelatedOpenWork<
  T extends {
    id: string;
    type: string;
    name: string;
    aliases?: unknown;
    status?: string | null;
  },
>(args: { objects: readonly T[]; text: string; limit?: number }): T[] {
  const evidenceTokens = extractWorkTokens(args.text);
  if (evidenceTokens.length === 0) return [];
  const matches: T[] = [];
  for (const row of args.objects) {
    if (!OPEN_WORK_TYPES.has(row.type)) continue;
    if (CLOSED_WORK_STATUSES.has((row.status ?? '').toLowerCase())) continue;
    const objectTokens = [row.name, ...aliasStrings(row.aliases)].flatMap(extractWorkTokens);
    if (objectTokens.length === 0) continue;
    if (workTokensOverlap(objectTokens, evidenceTokens)) matches.push(row);
  }
  return matches.slice(0, args.limit ?? 12);
}

function localRefSlug(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .replace(/[^a-z0-9]+$/, '')
    .slice(0, 80)
    .replace(/[^a-z0-9]+$/, '');
  return normalized.length > 0 ? normalized : 'task';
}

function ensureTaskLocalRef(
  payload: Record<string, unknown>,
  title: string,
  used: Set<string>,
): string {
  const existing =
    typeof payload.localRef === 'string' ? payload.localRef.trim().toLowerCase() : '';
  if (existing.length > 0) {
    used.add(existing);
    payload.localRef = existing;
    return existing;
  }
  const canonical =
    typeof payload.canonicalName === 'string' && payload.canonicalName.trim().length > 0
      ? payload.canonicalName
      : title;
  let slug = localRefSlug(canonical);
  let suffix = 2;
  while (used.has(slug)) {
    slug = `${localRefSlug(canonical).slice(0, 70)}-${String(suffix)}`;
    suffix += 1;
  }
  used.add(slug);
  payload.localRef = slug;
  return slug;
}

function itemCreateType(item: HubAttachableItem): string | null {
  if (item.operation !== 'create') return null;
  if (item.targetKind === 'task') return 'task';
  if (item.targetKind !== 'object') return null;
  return typeof item.proposedPayload.type === 'string' ? item.proposedPayload.type : null;
}

function relationshipTargetsCompany(
  item: HubAttachableItem,
  companyId: string,
  fromRef: string | null,
): boolean {
  if (item.targetKind !== 'object_relationship') return false;
  const payload = item.proposedPayload;
  if (payload.kind !== 'related') return false;
  const toId = typeof payload.toEntityId === 'string' ? payload.toEntityId : null;
  const fromId = typeof payload.fromEntityId === 'string' ? payload.fromEntityId : null;
  const itemFromRef =
    typeof payload.fromRef === 'string' ? payload.fromRef.trim().toLowerCase() : null;
  const itemToRef = typeof payload.toRef === 'string' ? payload.toRef.trim().toLowerCase() : null;
  const mentionsCompany = toId === companyId || fromId === companyId;
  if (!mentionsCompany) return false;
  if (!fromRef) return true;
  return itemFromRef === fromRef || itemToRef === fromRef;
}

function attachUniqueHubsToTaskItem<T extends HubAttachableItem>(
  item: T,
  qualified: QualifiedWorkspaceHubs,
  siblings: readonly HubAttachableItem[],
  usedRefs: Set<string>,
): { item: T; relationship: T | null } {
  if (itemCreateType(item) !== 'task') return { item, relationship: null };
  const payload = { ...item.proposedPayload };
  let changed = false;

  if (qualified.uniqueProject) {
    if (payload.parentObjectId !== qualified.uniqueProject.id) {
      payload.parentObjectId = qualified.uniqueProject.id;
      payload.projectName = qualified.uniqueProject.name;
      delete payload.createProjectName;
      changed = true;
    }
  } else if (typeof payload.parentObjectId === 'string' && payload.parentObjectId) {
    delete payload.parentObjectId;
    delete payload.projectName;
    changed = true;
  }

  let relationship: T | null = null;
  const uniqueCompany = qualified.uniqueCompany;
  if (uniqueCompany && siblings.length < MAX_BUNDLE_ITEMS_AFTER_ATTACH) {
    const fromRef = ensureTaskLocalRef(payload, item.title, usedRefs);
    const alreadyRelated = siblings.some((candidate) =>
      relationshipTargetsCompany(candidate, uniqueCompany.id, fromRef),
    );
    if (!alreadyRelated) {
      relationship = {
        ...item,
        operation: 'create',
        targetKind: 'object_relationship',
        title: `Relate ${item.title} to ${uniqueCompany.name}`,
        description: `The evidence uniquely names existing ${uniqueCompany.type} "${uniqueCompany.name}".`,
        proposedPayload: {
          kind: 'related',
          fromRef,
          toEntityId: uniqueCompany.id,
        },
      };
      changed = true;
    }
  } else if (uniqueCompany) {
    ensureTaskLocalRef(payload, item.title, usedRefs);
  }

  return {
    item: changed ? { ...item, proposedPayload: payload } : item,
    relationship,
  };
}

export function attachUniqueHubsToBundles<T extends HubAttachableItem>(args: {
  bundles: HubAttachableBundle<T>[];
  qualified: QualifiedWorkspaceHubs;
}): HubAttachableBundle<T>[] {
  return args.bundles.map((bundle) => {
    const usedRefs = new Set<string>();
    for (const item of bundle.items) {
      const ref =
        typeof item.proposedPayload.localRef === 'string'
          ? item.proposedPayload.localRef.trim().toLowerCase()
          : '';
      if (ref) usedRefs.add(ref);
    }
    const items: T[] = [];
    for (const item of bundle.items) {
      const attached = attachUniqueHubsToTaskItem(
        item,
        args.qualified,
        [...bundle.items, ...items],
        usedRefs,
      );
      items.push(attached.item);
      if (attached.relationship && items.length < MAX_BUNDLE_ITEMS_AFTER_ATTACH) {
        items.push(attached.relationship);
      }
    }
    return { ...bundle, items };
  });
}

/**
 * When related-token recall lists two or more open tasks, a guessed
 * completion is not a unique write. Strip `status: done|shipped|complete`
 * from updates targeting those ids and drop the item if nothing else remains.
 */
export function stripAmbiguousLifecycleUpdates<T extends HubAttachableItem>(args: {
  bundles: HubAttachableBundle<T>[];
  relatedOpenWorkIds: readonly string[];
}): HubAttachableBundle<T>[] {
  if (args.relatedOpenWorkIds.length < 2) return args.bundles;
  const ambiguous = new Set(args.relatedOpenWorkIds);
  return args.bundles.flatMap((bundle) => {
    const items: T[] = [];
    for (const item of bundle.items) {
      if (item.operation !== 'update') {
        items.push(item);
        continue;
      }
      const targetId = item.targetId;
      if (typeof targetId !== 'string' || !ambiguous.has(targetId)) {
        items.push(item);
        continue;
      }
      const status = item.proposedPayload.status;
      if (typeof status !== 'string' || !CLOSED_LIFECYCLE_STATUSES.has(status.toLowerCase())) {
        items.push(item);
        continue;
      }
      const proposedPayload = { ...item.proposedPayload };
      delete proposedPayload.status;
      if (Object.keys(proposedPayload).length === 0) continue;
      items.push({ ...item, proposedPayload });
    }
    return items.length > 0 ? [{ ...bundle, items }] : [];
  });
}

export function hubsChanged(
  before: readonly HubAttachableItem[],
  after: readonly HubAttachableItem[],
): boolean {
  if (before.length !== after.length) return true;
  return before.some((item, index) => {
    const next = after[index];
    if (!next) return true;
    return (
      item.targetKind !== next.targetKind ||
      item.title !== next.title ||
      JSON.stringify(item.proposedPayload) !== JSON.stringify(next.proposedPayload)
    );
  });
}
