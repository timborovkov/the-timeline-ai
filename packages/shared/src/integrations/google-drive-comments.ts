/**
 * Drive comment fingerprints hash every page. Event context ranks every
 * commentsHash field change ahead of unchanged comments so a transition past
 * the first eight still reaches the judged event. All changed comments are
 * packed (the event splitter can span events); only unchanged context is
 * limited to eight.
 * `comments.list` omits deleted comments (`includeDeleted=false`), so
 * removals are recovered by comparing previous snapshot ids to the next set.
 * Reply bodies are part of the fingerprint: new or changed replies rank first
 * inside the comment line, and `commentsHash` advances only when every changed
 * reply appears in packed event context. Full compacted comment and reply text
 * is kept through hashing and change detection; packed event context
 * preview-truncates only unchanged comments and replies.
 */

export const DRIVE_COMMENT_EVENT_LIMIT = 8;
export const DRIVE_COMMENT_PREVIEW_CHARS = 240;

/** Fields that feed `commentsHash`. Ranking must classify a change for each. */
export const DRIVE_COMMENT_HASH_FIELDS = [
  'id',
  'content',
  'resolved',
  'modifiedTime',
  'replies',
] as const;
export type DriveCommentHashField = (typeof DRIVE_COMMENT_HASH_FIELDS)[number];

interface DriveCommentReply {
  id?: string;
  content?: string;
  modifiedTime?: string;
  author?: { displayName?: string; emailAddress?: string };
}

export interface DriveComment {
  id?: string;
  content?: string;
  resolved?: boolean;
  modifiedTime?: string;
  author?: { displayName?: string; emailAddress?: string };
  replies?: DriveCommentReply[];
}

interface DriveCommentReplySnapshot {
  id: string;
  content: string;
  modifiedTime: string;
  author: string;
}

export interface DriveCommentSnapshot {
  id: string;
  content: string;
  resolved: boolean;
  modifiedTime: string;
  author: string;
  replies: DriveCommentReplySnapshot[];
}

export type DriveCommentHashRecord = {
  [Field in DriveCommentHashField]: Field extends 'resolved' ? boolean : string;
};

export type DriveCommentChangeKind =
  'added' | 'edited' | 'resolved' | 'reopened' | 'updated' | 'removed' | 'unchanged';

function compactPreview(value: string): string {
  return compactReplyText(value).slice(0, DRIVE_COMMENT_PREVIEW_CHARS);
}

/** Collapse whitespace but keep the full reply for hashing and change detection. */
function compactReplyText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function replyAuthor(reply: DriveCommentReply | DriveCommentReplySnapshot): string {
  if (typeof reply.author === 'string' && reply.author.length > 0) return reply.author;
  if (reply.author && typeof reply.author === 'object') {
    return reply.author.displayName ?? reply.author.emailAddress ?? 'Someone';
  }
  return 'Someone';
}

function compactDriveCommentReplies(
  replies: DriveCommentReply[] | DriveCommentReplySnapshot[] | undefined,
): DriveCommentReplySnapshot[] {
  if (!Array.isArray(replies)) return [];
  return replies.map((reply) => ({
    id: reply.id ?? '',
    content: compactReplyText(reply.content ?? ''),
    modifiedTime: reply.modifiedTime ?? '',
    author: replyAuthor(reply),
  }));
}

function driveCommentRepliesFingerprint(comment: DriveComment | DriveCommentSnapshot): string {
  return JSON.stringify(
    compactDriveCommentReplies(comment.replies).map((reply) => ({
      id: reply.id,
      content: reply.content,
      modifiedTime: reply.modifiedTime,
    })),
  );
}

export function driveCommentHashRecord(
  comment: DriveComment | DriveCommentSnapshot,
): DriveCommentHashRecord {
  return {
    id: comment.id ?? '',
    content: comment.content ?? '',
    resolved: Boolean(comment.resolved),
    modifiedTime: comment.modifiedTime ?? '',
    replies: driveCommentRepliesFingerprint(comment),
  };
}

/** Stored hash JSON keeps `modified` so existing `commentsHash` values stay stable. */
export function driveCommentsHashEntries(
  comments: DriveComment[],
  hashContent: (value: string) => string,
): {
  id: string;
  resolved: boolean;
  modified: string;
  content: string;
  replies?: string;
}[] {
  return comments.map((comment) => {
    const record = driveCommentHashRecord(comment);
    const entry: {
      id: string;
      resolved: boolean;
      modified: string;
      content: string;
      replies?: string;
    } = {
      id: record.id,
      resolved: record.resolved,
      modified: record.modifiedTime,
      content: hashContent(record.content),
    };
    if (record.replies !== '[]') entry.replies = hashContent(record.replies);
    return entry;
  });
}

export function compactDriveComments(comments: DriveComment[]): DriveCommentSnapshot[] {
  return comments.map((comment) => ({
    id: comment.id ?? '',
    content: compactReplyText(comment.content ?? ''),
    resolved: Boolean(comment.resolved),
    modifiedTime: comment.modifiedTime ?? '',
    author: comment.author?.displayName ?? comment.author?.emailAddress ?? 'Someone',
    replies: compactDriveCommentReplies(comment.replies),
  }));
}

function parseDriveCommentReplySnapshots(value: unknown): DriveCommentReplySnapshot[] {
  if (!Array.isArray(value)) return [];
  const found: DriveCommentReplySnapshot[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    found.push({
      id: typeof record.id === 'string' ? record.id : '',
      content: typeof record.content === 'string' ? record.content : '',
      modifiedTime: typeof record.modifiedTime === 'string' ? record.modifiedTime : '',
      author:
        typeof record.author === 'string' && record.author.length > 0 ? record.author : 'Someone',
    });
  }
  return found;
}

export function parseDriveCommentSnapshots(value: unknown): DriveCommentSnapshot[] {
  if (!Array.isArray(value)) return [];
  const found: DriveCommentSnapshot[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    if (typeof record.id !== 'string') continue;
    found.push({
      id: record.id,
      content: typeof record.content === 'string' ? record.content : '',
      resolved: Boolean(record.resolved),
      modifiedTime: typeof record.modifiedTime === 'string' ? record.modifiedTime : '',
      author:
        typeof record.author === 'string' && record.author.length > 0 ? record.author : 'Someone',
      replies: parseDriveCommentReplySnapshots(record.replies),
    });
  }
  return found;
}

function classifyDriveCommentChange(
  previous: DriveCommentSnapshot | undefined,
  next: DriveCommentSnapshot,
): Exclude<DriveCommentChangeKind, 'removed'> {
  if (!previous) return 'added';
  const prior = driveCommentHashRecord(previous);
  const current = driveCommentHashRecord(next);
  if (prior.content !== current.content) return 'edited';
  if (prior.resolved !== current.resolved) return current.resolved ? 'resolved' : 'reopened';
  for (const field of DRIVE_COMMENT_HASH_FIELDS) {
    if (field === 'id' || field === 'content' || field === 'resolved') continue;
    if (prior[field] !== current[field]) return 'updated';
  }
  return 'unchanged';
}

export function diffDriveComments(
  previous: DriveCommentSnapshot[],
  next: DriveCommentSnapshot[],
): { comment: DriveCommentSnapshot; kind: DriveCommentChangeKind }[] {
  const previousById = new Map(
    previous.filter((comment) => comment.id).map((comment) => [comment.id, comment]),
  );
  const changed: { comment: DriveCommentSnapshot; kind: DriveCommentChangeKind }[] = [];
  const removed: { comment: DriveCommentSnapshot; kind: DriveCommentChangeKind }[] = [];
  const unchanged: { comment: DriveCommentSnapshot; kind: DriveCommentChangeKind }[] = [];
  const seen = new Set<string>();
  for (const comment of next) {
    if (comment.id) {
      if (seen.has(comment.id)) continue;
      seen.add(comment.id);
    }
    const prior = comment.id ? previousById.get(comment.id) : undefined;
    const kind = classifyDriveCommentChange(prior, comment);
    if (kind === 'unchanged') unchanged.push({ comment, kind });
    else changed.push({ comment, kind });
  }
  for (const prior of previous) {
    if (!prior.id || seen.has(prior.id)) continue;
    seen.add(prior.id);
    removed.push({ comment: prior, kind: 'removed' });
  }
  return [...removed, ...changed, ...unchanged];
}

type DriveCommentReplyChangeKind = 'added' | 'edited' | 'removed';

export interface DriveCommentReplyChange {
  commentId: string;
  reply: DriveCommentReplySnapshot;
  kind: DriveCommentReplyChangeKind;
}

function replyFingerprint(reply: DriveCommentReplySnapshot): string {
  return JSON.stringify({
    id: reply.id,
    content: reply.content,
    modifiedTime: reply.modifiedTime,
  });
}

function replyContextFragment(
  reply: DriveCommentReplySnapshot,
  kind: DriveCommentReplyChangeKind,
): string {
  const label = kind === 'removed' ? 'reply removed' : 'reply';
  return reply.content
    ? `${reply.author} (${label}): ${reply.content}`
    : `${reply.author} (${label})`;
}

function classifyDriveCommentReplyChange(
  previous: DriveCommentReplySnapshot | undefined,
  next: DriveCommentReplySnapshot,
): DriveCommentReplyChangeKind | 'unchanged' {
  if (!previous) return 'added';
  return replyFingerprint(previous) === replyFingerprint(next) ? 'unchanged' : 'edited';
}

type RankedReplyKind = DriveCommentReplyChangeKind | 'unchanged';

function rankDriveCommentReplies(
  previous: DriveCommentReplySnapshot[],
  next: DriveCommentReplySnapshot[],
  commentKind: DriveCommentChangeKind,
): { reply: DriveCommentReplySnapshot; kind: RankedReplyKind }[] {
  if (commentKind === 'removed') {
    return previous.map((reply) => ({ reply, kind: 'removed' as const }));
  }
  const previousById = new Map(
    previous.filter((reply) => reply.id).map((reply) => [reply.id, reply]),
  );
  const seen = new Set<string>();
  const changed: { reply: DriveCommentReplySnapshot; kind: RankedReplyKind }[] = [];
  const unchanged: { reply: DriveCommentReplySnapshot; kind: RankedReplyKind }[] = [];
  for (const reply of next) {
    if (reply.id) {
      if (seen.has(reply.id)) continue;
      seen.add(reply.id);
    }
    const kind = classifyDriveCommentReplyChange(
      reply.id ? previousById.get(reply.id) : undefined,
      reply,
    );
    if (kind === 'unchanged') unchanged.push({ reply, kind });
    else changed.push({ reply, kind });
  }
  const removed = previous
    .filter((reply) => reply.id && !seen.has(reply.id))
    .map((reply) => ({ reply, kind: 'removed' as const }));
  return [...removed, ...changed, ...unchanged];
}

export function changedDriveCommentReplies(
  previous: DriveCommentSnapshot[],
  next: DriveCommentSnapshot[],
): DriveCommentReplyChange[] {
  const previousById = new Map(
    previous.filter((comment) => comment.id).map((comment) => [comment.id, comment]),
  );
  const seen = new Set<string>();
  const changed: DriveCommentReplyChange[] = [];
  for (const comment of next) {
    if (comment.id) {
      if (seen.has(comment.id)) continue;
      seen.add(comment.id);
    }
    const prior = comment.id ? previousById.get(comment.id) : undefined;
    for (const entry of rankDriveCommentReplies(prior?.replies ?? [], comment.replies, 'updated')) {
      if (entry.kind === 'unchanged') continue;
      changed.push({ commentId: comment.id, reply: entry.reply, kind: entry.kind });
    }
  }
  for (const prior of previous) {
    if (!prior.id || seen.has(prior.id)) continue;
    seen.add(prior.id);
    for (const reply of prior.replies) {
      changed.push({ commentId: prior.id, reply, kind: 'removed' });
    }
  }
  return changed;
}

function commentContextState(kind: DriveCommentChangeKind, comment: DriveCommentSnapshot): string {
  if (kind === 'removed') return 'removed';
  if (kind === 'reopened') return 'reopened';
  if (kind === 'updated') return 'updated';
  return comment.resolved ? 'resolved' : 'open';
}

function commentContextLine(
  comment: DriveCommentSnapshot,
  kind: DriveCommentChangeKind,
  previous?: DriveCommentSnapshot,
): string {
  const state = commentContextState(kind, comment);
  const packedContent = kind === 'unchanged' ? compactPreview(comment.content) : comment.content;
  const head = packedContent
    ? `${comment.author} (${state}): ${packedContent}`
    : `${comment.author} (${state})`;
  const ranked = rankDriveCommentReplies(previous?.replies ?? [], comment.replies, kind);
  if (ranked.length === 0) return head;
  const replies = ranked
    .map(({ reply, kind: replyKind }) => {
      const packed =
        replyKind === 'unchanged' ? { ...reply, content: compactPreview(reply.content) } : reply;
      return replyContextFragment(packed, replyKind === 'unchanged' ? 'added' : replyKind);
    })
    .join(' / ');
  return replies ? `${head} — ${replies}` : head;
}

export function commentEventContext(
  next: DriveComment[],
  previous: DriveCommentSnapshot[] = [],
): string {
  const previousById = new Map(
    previous.filter((comment) => comment.id).map((comment) => [comment.id, comment]),
  );
  const ranked = diffDriveComments(previous, compactDriveComments(next));
  const changed = ranked.filter((entry) => entry.kind !== 'unchanged');
  const unchanged = ranked.filter((entry) => entry.kind === 'unchanged');
  const unchangedRoom = Math.max(0, DRIVE_COMMENT_EVENT_LIMIT - changed.length);
  return [...changed, ...unchanged.slice(0, unchangedRoom)]
    .map(({ comment, kind }) =>
      commentContextLine(comment, kind, comment.id ? previousById.get(comment.id) : undefined),
    )
    .join('\n');
}

function commentNeedle(comment: DriveCommentSnapshot, kind: DriveCommentChangeKind): string {
  if (comment.content) return comment.content;
  return `${comment.author} (${commentContextState(kind, comment)})`;
}

/** Packed context must contain every changed comment and every changed reply. */
export function driveCommentChangeIsWitnessed(
  context: string,
  previous: DriveCommentSnapshot[],
  next: DriveCommentSnapshot[],
): boolean {
  if (!context.trim()) return false;
  const ranked = diffDriveComments(previous, next).filter((entry) => entry.kind !== 'unchanged');
  const replyChanges = changedDriveCommentReplies(previous, next);
  if (ranked.length === 0 && replyChanges.length === 0) return false;
  for (const entry of ranked) {
    if (!context.includes(commentNeedle(entry.comment, entry.kind))) return false;
  }
  for (const change of replyChanges) {
    const fragment = replyContextFragment(change.reply, change.kind);
    const fallback = change.reply.content || change.reply.author;
    if (!context.includes(fragment) && !context.includes(fallback)) return false;
  }
  return true;
}
