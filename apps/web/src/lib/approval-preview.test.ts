import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import { buildApprovalPreviewFields } from '@/lib/approval-preview';
describe('buildApprovalPreviewFields', () => {
  it('treats every proposed field as new on create', () => {
    const { fields, timestamps } = buildApprovalPreviewFields({
      operation: 'create',
      targetKind: 'task',
      title: 'Review planning workbook',
      proposedPayload: {
        type: 'task',
        canonicalName: 'Review planning workbook',
        status: 'todo',
        dueAt: '2026-08-20T00:00:00.000Z',
        description: 'Prepare the rollout notes',
      },
      snapshot: { kind: 'none' },
      members: {},
      timezone: 'UTC',
    });

    expect(timestamps.createdAt).toBeNull();
    expect(fields.find((field) => field.key === 'title')).toMatchObject({
      proposed: 'Review planning workbook',
      changed: true,
    });
    expect(fields.find((field) => field.key === 'status')).toMatchObject({
      proposed: 'Todo',
      changed: true,
    });
    expect(fields.find((field) => field.key === 'description')?.changed).toBe(true);
  });

  it('highlights only fields that differ from the live snapshot', () => {
    const { fields, timestamps } = buildApprovalPreviewFields({
      operation: 'update',
      targetKind: 'task',
      title: 'Review planning workbook',
      proposedPayload: {
        status: 'doing',
        dueAt: '2026-08-21T00:00:00.000Z',
      },
      snapshot: {
        kind: 'object',
        object: {
          id: 'task-1',
          type: 'task',
          title: 'Review planning workbook',
          status: 'todo',
          stage: null,
          priority: 2,
          ownerUserId: null,
          assigneeUserId: 'user-1',
          dueAt: '2026-08-20T00:00:00.000Z',
          aliases: [],
          content: 'Existing notes',
          createdAt: '2026-08-01T10:00:00.000Z',
          updatedAt: '2026-08-16T10:00:00.000Z',
          archivedAt: null,
        },
      },
      members: { 'user-1': 'Cameron' },
      timezone: 'UTC',
    });

    expect(timestamps.createdAt).toBe('2026-08-01T10:00:00.000Z');
    expect(fields.find((field) => field.key === 'title')).toMatchObject({
      current: 'Review planning workbook',
      proposed: 'Review planning workbook',
      changed: false,
    });
    expect(fields.find((field) => field.key === 'status')).toMatchObject({
      current: 'Todo',
      proposed: 'Doing',
      changed: true,
    });
    expect(fields.find((field) => field.key === 'assigneeUserId')).toMatchObject({
      current: 'Cameron',
      changed: false,
    });
  });

  it('formats all-day schedule boundaries as inclusive event-local dates', () => {
    const { fields } = buildApprovalPreviewFields({
      operation: 'create',
      targetKind: 'calendar_event',
      title: 'Full-day planning',
      proposedPayload: {
        allDay: true,
        startAt: '2026-06-30T22:00:00.000Z',
        endAt: '2026-07-02',
        timezone: 'Europe/Berlin',
      },
      snapshot: { kind: 'none' },
      members: {},
      timezone: 'America/Los_Angeles',
      locale: 'de-DE',
    });

    expect(fields.find((field) => field.key === 'startAt')?.proposed).toBe('01.07.2026');
    expect(fields.find((field) => field.key === 'endAt')?.proposed).toBe('01.07.2026');
  });
});
