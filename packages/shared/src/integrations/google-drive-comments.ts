/**
 * Drive comment fingerprints hash every page. Event context is bounded, so
 * added / edited / resolved / removed comments must be ranked ahead of
 * unchanged ones or a change past the first eight never reaches the judged
 * event. `comments.list` omits deleted comments (`includeDeleted=false`), so
 * removals are recovered by comparing previous snapshot ids to the next set.
 */

export const DRIVE_COMMENT_EVENT_LIMIT = 8;
const DRIVE_COMMENT_PREVIEW_CHARS = 240;

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

type DriveCommentChangeKind = 'added' | 'edited' | 'resolved' | 'removed' | 'unchanged';

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
    if (!prior) {
      changed.push({ comment, kind: 'added' });
      continue;
    }
    if (comment.content !== prior.content) {
      changed.push({ comment, kind: 'edited' });
      continue;
    }
    if (comment.resolved && !prior.resolved) {
      changed.push({ comment, kind: 'resolved' });
      continue;
    }
    unchanged.push({ comment, kind: 'unchanged' });
  }
  for (const prior of previous) {
    if (!prior.id || seen.has(prior.id)) continue;
    seen.add(prior.id);
    removed.push({ comment: prior, kind: 'removed' });
  }
  return [...removed, ...changed, ...unchanged];
}

export function commentEventContext(
  next: DriveComment[],
  previous: DriveCommentSnapshot[] = [],
): string {
  return diffDriveComments(previous, compactDriveComments(next))
    .slice(0, DRIVE_COMMENT_EVENT_LIMIT)
    .map(({ comment, kind }) => {
      const state = kind === 'removed' ? 'removed' : comment.resolved ? 'resolved' : 'open';
      return comment.content
        ? `${comment.author} (${state}): ${comment.content}`
        : `${comment.author} (${state})`;
    })
    .join('\n');
}
