// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { PointerEventsCheckLevel } from '@testing-library/user-event';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  refresh: vi.fn(),
  acceptSuggestionItemAction: vi.fn(),
  rejectSuggestionItemAction: vi.fn(),
  reviseSuggestionItemAction: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: fakes.refresh }),
}));
vi.mock('@/app/actions/suggestions', () => ({
  acceptSuggestionItemAction: fakes.acceptSuggestionItemAction,
  rejectSuggestionItemAction: fakes.rejectSuggestionItemAction,
  reviseSuggestionItemAction: fakes.reviseSuggestionItemAction,
}));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), loading: vi.fn(() => 'toast-1'), error: vi.fn() },
}));

const { ToolStep } = await import('./tool-step.js');

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe('ToolStep', () => {
  it('uses an announced status and only mounts raw tool data while its disclosure is open', async () => {
    const { container, rerender } = render(
      <ToolStep
        name="search_timeline"
        state="input-streaming"
        input={{ query: 'open customer work' }}
      />,
    );

    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Running');
    expect(status.tagName).toBe('OUTPUT');
    expect(screen.getByText('Searched timeline for "open customer work"')).toBeTruthy();
    expect(screen.getByText('Technical details')).toBeTruthy();
    expect(container.querySelector('details')?.hasAttribute('open')).toBe(false);
    expect(container.querySelector('pre')).toBeNull();
    expect(container.textContent).not.toContain('⏳');
    expect(container.querySelector('svg')?.getAttribute('class')).toContain(
      'motion-reduce:animate-none',
    );

    await userEvent
      .setup({ pointerEventsCheck: PointerEventsCheckLevel.Never })
      .click(screen.getByText('Technical details'));
    expect(container.querySelector('pre')?.textContent).toContain('open customer work');
    await userEvent
      .setup({ pointerEventsCheck: PointerEventsCheckLevel.Never })
      .click(screen.getByText('Technical details'));
    expect(container.querySelector('pre')).toBeNull();

    rerender(
      <ToolStep
        name="search_timeline"
        state="output-available"
        input={{ query: 'open customer work' }}
        output={{ count: 1 }}
      />,
    );

    expect(screen.getByRole('status').textContent).toContain('Completed');
  });

  it('keeps inline approval actions named and updates the accepted item', async () => {
    const itemId = '11111111-1111-4111-8111-111111111112';
    const user = userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never });
    fakes.acceptSuggestionItemAction.mockResolvedValue({ ok: true });
    render(
      <ToolStep
        name="suggest_object_memory"
        state="output-available"
        output={{
          suggestion: {
            id: '22222222-2222-4222-8222-222222222223',
            title: 'PRH company registration',
            evidence: [],
            items: [
              {
                id: itemId,
                status: 'pending',
                targetKind: 'task',
                title: 'Tim to register with PRH',
              },
            ],
          },
        }}
      />,
    );

    const accept = screen.getByRole('button', { name: 'Accept Tim to register with PRH' });
    expect(accept).toBeTruthy();
    expect(accept.getAttribute('class')).toContain('focus-visible:ring-fg-muted');
    expect(screen.getByRole('button', { name: 'Change Tim to register with PRH' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reject Tim to register with PRH' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Accept Tim to register with PRH' }));

    await waitFor(() => {
      expect(screen.getByText('Accepted')).toBeTruthy();
    });
    expect(fakes.acceptSuggestionItemAction).toHaveBeenCalledWith({ itemId });
  });

  it('renders source names and immediately updates a revised inline proposal', async () => {
    const itemId = '11111111-1111-4111-8111-111111111111';
    const user = userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never });
    fakes.reviseSuggestionItemAction.mockResolvedValue({
      ok: true,
      revisedItem: {
        id: itemId,
        status: 'pending',
        title: 'Miku to register with PRH',
        description: 'Miku made the promise.',
        proposedPayload: { ownerName: 'Miku' },
      },
    });
    render(
      <ToolStep
        name="suggest_object_memory"
        state="output-available"
        output={{
          suggestion: {
            id: '22222222-2222-4222-8222-222222222222',
            title: 'PRH company registration',
            evidence: [
              {
                rawEventId: '33333333-3333-4333-8333-333333333333',
                quote: '@timbo0 I will register the company with PRH.',
                source: 'telegram',
                senderName: 'Miku',
                senderHandle: '@mikael',
                senderTimelineName: 'Mikael Rintala',
                conversationName: 'AuditAI founders',
              },
            ],
            items: [
              {
                id: itemId,
                status: 'pending',
                targetKind: 'task',
                title: 'Tim to register with PRH',
                description: 'Tim made the promise.',
              },
            ],
          },
        }}
      />,
    );

    expect(
      screen.getByText('Mikael Rintala (Miku, @mikael) in AuditAI founders on Telegram'),
    ).toBeTruthy();
    expect(screen.getByText('Pending')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Change Tim to register with PRH' }));
    const dialog = screen.getByRole('dialog');
    await user.type(
      within(dialog).getByLabelText('What should change?'),
      'Miku made this promise, not Tim.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Update proposal' }));

    await waitFor(() => {
      expect(screen.getByText('Miku to register with PRH')).toBeTruthy();
    });
    expect(screen.queryByText('Tim to register with PRH')).toBeNull();
  });

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

    expect(html).toContain('Approval needed');
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

  it('shows calendar tool server messages when output is available', () => {
    const html = renderToStaticMarkup(
      createElement(ToolStep, {
        name: 'execute_calendar_create',
        state: 'output-available',
        input: {
          title: 'Pilot planning',
          startAt: '2026-06-14T10:00:00.000Z',
          endAt: '2026-06-14T10:30:00.000Z',
        },
        output: {
          ok: true,
          message: 'Reused existing calendar suggestion for Pilot planning.',
        },
      }),
    );

    expect(html).toContain('Reused existing calendar suggestion for Pilot planning.');
    expect(html).not.toContain('Create Pilot planning');
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

    expect(html).toContain('Approval needed');
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

    expect(html).toContain('Approval needed');
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

    expect(html).toContain('Approval needed');
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

    expect(html).toContain('Approval needed');
    expect(html).toContain('from');
    expect(html).toContain('; to');
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

    expect(html).toContain('Approval needed');
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

    expect(html).toContain('Approval needed');
    expect(html).toContain('Keep');
    expect(html).toContain('Merge');
    expect(html).toContain('[ent:aaaaaaaa]');
    expect(html).toContain('[ent:bbbbbbbb]');
    expect(html).toContain('User confirmed these are duplicates.');
  });
});
