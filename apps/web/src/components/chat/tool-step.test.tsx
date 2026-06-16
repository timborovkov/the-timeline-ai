import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock('@/app/actions/suggestions', () => ({
  acceptSuggestionItemAction: vi.fn(),
  rejectSuggestionItemAction: vi.fn(),
}));

const { ToolStep } = await import('./tool-step.js');

describe('ToolStep', () => {
  it('renders in-chat approval controls for approval-requested tools', () => {
    const html = renderToStaticMarkup(
      createElement(ToolStep, {
        name: 'execute_object_update',
        state: 'approval-requested',
        input: {
          entityId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          field: 'status',
          expectedCurrentValue: 'active',
          newValue: 'done',
          reason: 'User asked to mark it done in chat.',
        },
        approval: { id: 'approval-1' },
        onApprovalResponse: vi.fn(),
      }),
    );

    expect(html).toContain('approval required');
    expect(html).toContain('status');
    expect(html).toContain('active');
    expect(html).toContain('done');
    expect(html).toContain('Approve');
    expect(html).toContain('Deny');
  });

  it('summarizes completed direct object updates', () => {
    const html = renderToStaticMarkup(
      createElement(ToolStep, {
        name: 'execute_object_update',
        state: 'output-available',
        input: {
          field: 'status',
          expectedCurrentValue: 'active',
          newValue: 'done',
        },
        output: {
          ok: true,
          message: 'Updated Otto Silventola: status changed from active to done.',
        },
      }),
    );

    expect(html).toContain('Updated Otto Silventola: status changed from active to done.');
  });

  it('renders create-object approval details', () => {
    const html = renderToStaticMarkup(
      createElement(ToolStep, {
        name: 'execute_object_create',
        state: 'approval-requested',
        input: {
          type: 'project',
          canonicalName: 'AuditAI pilot',
          status: 'open',
          stage: 'planning',
          priority: 2,
          aliases: ['Pilot'],
          reason: 'User asked to track the pilot.',
        },
        approval: { id: 'approval-create' },
        onApprovalResponse: vi.fn(),
      }),
    );

    expect(html).toContain('approval required');
    expect(html).toContain('Type');
    expect(html).toContain('project');
    expect(html).toContain('Name');
    expect(html).toContain('AuditAI pilot');
    expect(html).toContain('Aliases');
    expect(html).toContain('Pilot');
  });

  it('renders archive-object approval details with an object chip', () => {
    const html = renderToStaticMarkup(
      createElement(ToolStep, {
        name: 'execute_object_archive',
        state: 'approval-requested',
        input: {
          entityId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          reason: 'User confirmed this object is obsolete.',
        },
        approval: { id: 'approval-archive' },
        onApprovalResponse: vi.fn(),
      }),
    );

    expect(html).toContain('approval required');
    expect(html).toContain('Object');
    expect(html).toContain('[ent:aaaaaaaa]');
    expect(html).toContain('User confirmed this object is obsolete.');
  });

  it('renders calendar-create approval details', () => {
    const html = renderToStaticMarkup(
      createElement(ToolStep, {
        name: 'execute_calendar_create',
        state: 'approval-requested',
        input: {
          title: 'Pilot planning',
          startAt: '2026-06-14T10:00:00.000Z',
          endAt: '2026-06-14T10:30:00.000Z',
          timezone: 'UTC',
          location: 'Zoom',
          reason: 'User asked to schedule it now.',
        },
        approval: { id: 'approval-calendar-create' },
        onApprovalResponse: vi.fn(),
      }),
    );

    expect(html).toContain('approval required');
    expect(html).toContain('Pilot planning');
    expect(html).toContain('Jun');
    expect(html).toContain('Zoom');
  });

  it('renders calendar-update approval details with an event chip', () => {
    const html = renderToStaticMarkup(
      createElement(ToolStep, {
        name: 'execute_calendar_update',
        state: 'approval-requested',
        input: {
          id: '12121212-1212-4212-8212-121212121212',
          expectedCurrent: {
            title: 'Daily standup',
            startAt: '2026-06-14T09:00:00.000Z',
            endAt: '2026-06-14T09:30:00.000Z',
          },
          patch: {
            title: 'Daily sync',
            startAt: '2026-06-14T10:00:00.000Z',
            endAt: '2026-06-14T10:30:00.000Z',
          },
          reason: 'User asked to rename it.',
        },
        approval: { id: 'approval-calendar-update' },
        onApprovalResponse: vi.fn(),
      }),
    );

    expect(html).toContain('approval required');
    expect(html).toContain('[cal:12121212]');
    expect(html).toContain('Current');
    expect(html).toContain('Proposed');
    expect(html).toContain('title: Daily sync');
  });

  it('renders calendar-cancel approval details with recurrence scope', () => {
    const html = renderToStaticMarkup(
      createElement(ToolStep, {
        name: 'execute_calendar_cancel',
        state: 'approval-requested',
        input: {
          id: '12121212-1212-4212-8212-121212121212',
          expectedCurrent: {
            title: 'Daily standup',
            startAt: '2026-06-14T09:00:00.000Z',
            endAt: '2026-06-14T09:30:00.000Z',
          },
          recurrenceEditMode: 'single',
          reason: 'User asked to cancel it.',
        },
        approval: { id: 'approval-calendar-cancel' },
        onApprovalResponse: vi.fn(),
      }),
    );

    expect(html).toContain('approval required');
    expect(html).toContain('[cal:12121212]');
    expect(html).toContain('single');
    expect(html).toContain('User asked to cancel it.');
  });

  it('renders object preview chips for merge approvals', () => {
    const survivorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const mergedId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

    const html = renderToStaticMarkup(
      createElement(ToolStep, {
        name: 'execute_object_merge',
        state: 'approval-requested',
        input: {
          objectIds: [survivorId, mergedId],
          survivorId,
          reason: 'User confirmed these are duplicates.',
        },
        approval: { id: 'approval-2' },
        onApprovalResponse: vi.fn(),
      }),
    );

    expect(html).toContain('approval required');
    expect(html).toContain('Keep');
    expect(html).toContain('Merge');
    expect(html).toContain('[ent:aaaaaaaa]');
    expect(html).toContain('[ent:bbbbbbbb]');
    expect(html).toContain('User confirmed these are duplicates.');
  });
});
