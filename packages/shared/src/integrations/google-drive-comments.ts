/**
 * Drive comment fingerprints hash every page. Event context is bounded, so
 * every commentsHash field change must rank ahead of unchanged comments or a
 * transition past the first eight never reaches the judged event.
 * `comments.list` omits deleted comments (`includeDeleted=false`), so
 * removals are recovered by comparing previous snapshot ids to the next set.
 */

export const DRIVE_COMMENT_EVENT_LIMIT = 8;
const DRIVE_COMMENT_PREVIEW_CHARS = 240;

/** Fields that feed `commentsHash`. Ranking must classify a change for each. */
export const DRIVE_COMMENT_HASH_FIELDS = ['id', 'content', 'resolved', 'modifiedTime'] as const;
export type DriveCommentHashField = (typeof DRIVE_COMMENT_HASH_FIELDS)[number];

export interface DriveComment {
  id?: string;
  content?: string;
  resolved?: boolean;
  modifiedTime?: string;
  author?: { displayName?: string; emailAddress?: string };
}

export interface DriveCommentSnapshot {
  id: string;
  content: string;
  resolved: boolean;
  modifiedTime: string;
  author: string;
}

export type DriveCommentHashRecord = {
  [Field in DriveCommentHashField]: Field extends 'resolved' ? boolean : string;
};

export type DriveCommentChangeKind =
  'added' | 'edited' | 'resolved' | 'reopened' | 'updated' | 'removed' | 'unchanged';

export function driveCommentHashRecord(
  comment: DriveComment | DriveCommentSnapshot,
): DriveCommentHashRecord {
  return {
    id: comment.id ?? '',
    content: comment.content ?? '',
    resolved: Boolean(comment.resolved),
    modifiedTime: comment.modifiedTime ?? '',
  };
}

/** Stored hash JSON keeps `modified` so existing `commentsHash` values stay stable. */
export function driveCommentsHashEntries(
  comments: DriveComment[],
  hashContent: (value: string) => string,
): { id: string; resolved: boolean; modified: string; content: string }[] {
  return comments.map((comment) => {
    const record = driveCommentHashRecord(comment);
    return {
      id: record.id,
      resolved: record.resolved,
      modified: record.modifiedTime,
      content: hashContent(record.content),
    };
  });
}

export function compactDriveComments(comments: DriveComment[]): DriveCommentSnapshot[] {
  return comments.map((comment) => ({
    id: comment.id ?? '',
    content: (comment.content ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, DRIVE_COMMENT_PREVIEW_CHARS),
    resolved: Boolean(comment.resolved),
    modifiedTime: comment.modifiedTime ?? '',
    author: comment.author?.displayName ?? comment.author?.emailAddress ?? 'Someone',
  }));
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

export function commentEventContext(
  next: DriveComment[],
  previous: DriveCommentSnapshot[] = [],
): string {
  return diffDriveComments(previous, compactDriveComments(next))
    .slice(0, DRIVE_COMMENT_EVENT_LIMIT)
    .map(({ comment, kind }) => {
      const state = commentContextState(kind, comment);
      return comment.content
        ? `${comment.author} (${state}): ${comment.content}`
        : `${comment.author} (${state})`;
    })
    .join('\n');
}
