import type { PinTargetRef } from '@timeline/shared/pins';

export type MutationChange =
  | { kind: 'object-created'; parentId?: string | null }
  | { kind: 'object-updated'; ids: string | string[] }
  | { kind: 'object-detail'; id: string }
  | { kind: 'object-pinned'; id: string }
  | { kind: 'objects-merged'; survivorId: string; mergedIds: string[] }
  | { kind: 'object-cleanup' }
  | { kind: 'object-memory-repair'; id: string }
  | { kind: 'object-change-accepted'; id: string }
  | { kind: 'notifications-read' }
  | { kind: 'board-changed'; boardId?: string; entityId?: string }
  | { kind: 'pins-changed'; target?: PinTargetRef }
  | { kind: 'suggestions-changed' }
  | { kind: 'documents-changed'; id?: string; captured?: boolean; timeline?: boolean };

interface MutationSurface {
  path: string;
  type?: 'page' | 'layout';
}

function pages(...paths: string[]): MutationSurface[] {
  return paths.map((path) => ({ path }));
}
const boardLayout: MutationSurface = { path: '/app/boards', type: 'layout' };

export function mutationSurfaces(change: MutationChange): MutationSurface[] {
  switch (change.kind) {
    case 'object-created':
      return pages(
        '/app/objects',
        '/app/work',
        ...(change.parentId ? [`/app/objects/${change.parentId}`] : []),
      );
    case 'object-updated':
      return [
        ...pages(
          ...(Array.isArray(change.ids) ? change.ids : [change.ids]).map(
            (id) => `/app/objects/${id}`,
          ),
          '/app/objects',
          '/app/work',
        ),
        boardLayout,
        ...pages('/app/tasks', '/app/approvals'),
      ];
    case 'object-detail':
      return pages(`/app/objects/${change.id}`, '/app/tasks', '/app/work', '/app/inbox');
    case 'object-pinned':
      return pages('/app', `/app/objects/${change.id}`);
    case 'objects-merged':
      return [
        ...pages(
          '/app/objects',
          '/app/work',
          '/app/approvals',
          '/app/inbox',
          `/app/objects/${change.survivorId}`,
          ...change.mergedIds.map((id) => `/app/objects/${id}`),
        ),
        boardLayout,
        ...pages('/app/tasks'),
      ];
    case 'object-cleanup':
      return pages('/app/objects', '/app/approvals', '/app/inbox');
    case 'object-memory-repair':
      return pages(`/app/objects/${change.id}`, '/app/approvals', '/app/inbox');
    case 'object-change-accepted':
      return [
        ...mutationSurfaces({ kind: 'object-detail', id: change.id }),
        ...pages('/app/objects', '/app/work'),
        boardLayout,
        ...pages('/app/tasks'),
      ];
    case 'notifications-read':
      return pages('/app/inbox');
    case 'board-changed':
      return pages(
        '/app',
        '/app/boards',
        '/app/work',
        ...(change.boardId ? [`/app/boards/${change.boardId}`] : []),
        ...(change.entityId ? [`/app/objects/${change.entityId}`] : []),
      );
    case 'pins-changed': {
      const surfaces = pages('/app', '/app/work');
      const target = change.target;
      if (target?.kind === 'object')
        surfaces.push(...pages(`/app/objects/${target.key}`, '/app/tasks'));
      if (target?.kind === 'board')
        surfaces.push(...pages(`/app/boards/${target.key}`, '/app/boards'));
      if (target?.kind === 'document')
        surfaces.push(...pages(`/app/documents/${target.key}`, '/app/documents'));
      if (target?.kind === 'meeting')
        surfaces.push(...pages(`/app/meetings/${target.key}`, '/app/meetings'));
      if (target?.kind === 'saved_meeting') surfaces.push(...pages('/app/meetings'));
      if (target?.kind === 'calendar_event') surfaces.push(...pages('/app/calendar'));
      if (target?.kind === 'timeline_moment') surfaces.push(...pages('/app/timeline'));
      return surfaces;
    }
    case 'suggestions-changed':
      return [
        { path: '/app', type: 'layout' },
        ...pages('/app/approvals', '/app/timeline'),
        { path: '/app/objects', type: 'layout' },
        boardLayout,
        ...pages('/app/calendar', '/app/tasks', '/app/inbox'),
      ];
    case 'documents-changed':
      return pages(
        '/app/documents',
        ...(change.captured ? ['/app/documents/captured'] : []),
        ...(change.id ? [`/app/documents/${change.id}`] : []),
        ...(change.timeline ? ['/app/timeline'] : []),
      );
  }
}
