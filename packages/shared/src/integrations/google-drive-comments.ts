/**
 * Drive comment fingerprints hash every page. Event context is bounded, so
 * every commentsHash field change must rank ahead of unchanged comments or a
 * transition past the first eight never reaches the judged event.
 * `comments.list` omits deleted comments (`includeDeleted=false`), so
 * removals are recovered by comparing previous snapshot ids to the next set.
 * Reply bodies are part of the fingerprint: a reply change must rank and appear
 * in event context before `commentsHash` advances.
 */

export const DRIVE_COMMENT_EVENT_LIMIT = 8;
const DRIVE_COMMENT_PREVIEW_CHARS = 240;

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
  return value.replace(/\s+/g, ' ').trim().slice(0, DRIVE_COMMENT_PREVIEW_CHARS);
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
    content: compactPreview(reply.content ?? ''),
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
    content: compactPreview(comment.content ?? ''),
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

function commentContextState(kind: DriveCommentChangeKind, comment: DriveCommentSnapshot): string {
  if (kind === 'removed') return 'removed';
  if (kind === 'reopened') return 'reopened';
  if (kind === 'updated') return 'updated';
  return comment.resolved ? 'resolved' : 'open';
}

function commentContextLine(comment: DriveCommentSnapshot, kind: DriveCommentChangeKind): string {
  const state = commentContextState(kind, comment);
  const head = comment.content
    ? `${comment.author} (${state}): ${comment.content}`
    : `${comment.author} (${state})`;
  if (comment.replies.length === 0) return head;
  const replies = comment.replies
    .map((reply) =>
      reply.content ? `${reply.author} (reply): ${reply.content}` : `${reply.author} (reply)`,
    )
    .join(' / ');
  return replies ? `${head} — ${replies}` : head;
}

export function commentEventContext(
  next: DriveComment[],
  previous: DriveCommentSnapshot[] = [],
): string {
  return diffDriveComments(previous, compactDriveComments(next))
    .slice(0, DRIVE_COMMENT_EVENT_LIMIT)
    .map(({ comment, kind }) => commentContextLine(comment, kind))
    .join('\n');
}
