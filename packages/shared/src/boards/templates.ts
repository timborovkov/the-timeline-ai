import type { BoardTemplateKind, BoardLaneInput } from '#src/boards/index.js';
import type { ObjectType } from '#src/objects/types.js';

export function defaultBoardRecommendedTypes(template: BoardTemplateKind): ObjectType[] {
  if (template === 'pipeline') return ['company', 'deal', 'person', 'project'];
  if (template === 'task_board') return ['task', 'follow_up'];
  if (template === 'catalog') return ['project', 'document', 'vendor', 'other'];
  return [];
}

export function defaultBoardLanes(template: BoardTemplateKind): BoardLaneInput[] {
  if (template === 'task_board') {
    return [
      { name: 'Backlog', kind: 'active' },
      { name: 'Ready', kind: 'active' },
      { name: 'Doing', kind: 'active' },
      { name: 'Review', kind: 'active' },
      { name: 'Done', kind: 'done' },
      { name: 'Blocked', kind: 'blocked' },
    ];
  }
  if (template === 'pipeline') {
    return [
      { name: 'New', kind: 'active' },
      { name: 'Qualified', kind: 'active' },
      { name: 'Scoping', kind: 'active' },
      { name: 'Proposal', kind: 'active' },
      { name: 'Committed', kind: 'done' },
      { name: 'Active', kind: 'active' },
      { name: 'Won', kind: 'terminal' },
      { name: 'Lost', kind: 'lost' },
    ];
  }
  if (template === 'catalog') {
    return [
      { name: 'Idea', kind: 'active' },
      { name: 'Evaluating', kind: 'active' },
      { name: 'Active', kind: 'active' },
      { name: 'Deprecated', kind: 'terminal' },
    ];
  }
  return [
    { name: 'Todo', kind: 'active' },
    { name: 'Doing', kind: 'active' },
    { name: 'Done', kind: 'done' },
  ];
}
