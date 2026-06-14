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
