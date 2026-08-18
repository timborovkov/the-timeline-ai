// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CollectionGroup } from '@/components/collections/collection-group';
import { CollectionRow } from '@/components/collections/collection-row';
import { CollectionStatus } from '@/components/collections/collection-status';
import { priorityTone, statusTone } from '@/components/collections/collection-status-tone';
import { CollectionToolbar } from '@/components/collections/collection-toolbar';
import { EditableMetadata } from '@/components/collections/editable-metadata';
import { MetadataDateEditor } from '@/components/collections/metadata-date-editor';
import { SelectionBar } from '@/components/collections/selection-bar';

describe('collection primitives', () => {
  afterEach(cleanup);

  it('maps workflow and priority semantics to stable icon-and-text tones', () => {
    expect(statusTone('backlog')).toBe('neutral');
    expect(statusTone('in progress')).toBe('progress');
    expect(statusTone('stuck')).toBe('progress');
    expect(statusTone('retrying')).toBe('progress');
    expect(statusTone('review')).toBe('review');
    expect(statusTone('shipped')).toBe('success');
    expect(statusTone('overdue')).toBe('danger');
    expect(priorityTone(1)).toBe('danger');
    expect(priorityTone(2)).toBe('progress');
    expect(priorityTone(4)).toBe('neutral');

    const { container } = render(<CollectionStatus value="blocked" />);
    expect(screen.getByText('Blocked')).toBeTruthy();
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('starts groups open and keeps collapse state local to the mounted group', async () => {
    const user = userEvent.setup();
    render(
      <CollectionGroup title="In progress" count={2}>
        <p>Group contents</p>
      </CollectionGroup>,
    );

    const trigger = screen.getByRole('button', { name: /In progress 2/ });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    await user.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByText('Group contents').closest('[hidden]')).toBeTruthy();
  });

  it('shows selection chrome only while items are selected', () => {
    const clear = vi.fn();
    const view = render(
      <SelectionBar count={0} actions={<button>Archive</button>} onClear={clear} />,
    );
    expect(screen.queryByText('Archive')).toBeNull();

    view.rerender(
      <SelectionBar
        count={2}
        label="objects selected"
        actions={<button>Archive</button>}
        onClear={clear}
      />,
    );
    expect(screen.getByText('2').parentElement?.textContent).toContain('objects selected');
    expect(screen.getByRole('button', { name: 'Clear selection' }).className).toContain('size-10');
  });

  it('uses a 44px desktop row with a two-line responsive content structure', () => {
    const { container } = render(
      <CollectionRow title="Launch plan" context="Acme" metadata={<span>P2</span>} />,
    );
    const row = container.firstElementChild;
    expect(row?.className).toContain('min-h-11');
    expect(row?.querySelector('.sm\\:flex-row')).toBeTruthy();
    expect(screen.getAllByText('Acme')).toHaveLength(2);
    expect(screen.getByText('P2')).toBeTruthy();
  });

  it('opens desktop filters, removes active chips, and exposes the mobile dialog variant', async () => {
    const user = userEvent.setup();
    const remove = vi.fn();
    render(
      <CollectionToolbar
        count="4 results"
        filters={
          <label>
            Owner <input aria-label="Owner" />
          </label>
        }
        activeFilters={[{ key: 'owner', label: 'Owner', value: 'Ada', onRemove: remove }]}
      />,
    );

    expect(screen.getByRole('button', { name: 'Remove Owner filter' }).className).toContain(
      'size-6',
    );
    await user.click(screen.getByRole('button', { name: 'Remove Owner filter' }));
    expect(remove).toHaveBeenCalledOnce();

    const triggers = screen.getAllByRole('button', { name: /Filters/ });
    const firstTrigger = triggers[0];
    const secondTrigger = triggers[1];
    if (!firstTrigger || !secondTrigger)
      throw new Error('expected desktop and mobile filter triggers');
    await user.click(firstTrigger);
    expect(screen.getByRole('dialog')).toBeTruthy();
    await user.keyboard('{Escape}');

    await user.click(secondTrigger);
    expect(screen.getByText('Refine the visible collection.')).toBeTruthy();
  });

  it('keeps metadata triggers accessible, reports row errors, and restores focus on Escape', async () => {
    const user = userEvent.setup();
    render(
      <EditableMetadata
        label="Priority for Launch plan"
        value="P2"
        error="Save failed"
        editor={
          <select aria-label="Priority" defaultValue="2">
            <option value="2">P2</option>
          </select>
        }
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Priority for Launch plan' });
    expect(trigger.className).toContain('min-h-10');
    expect(trigger.getAttribute('aria-invalid')).toBe('true');
    expect(trigger.getAttribute('aria-describedby')).toBe('priority-for-launch-plan-error');
    expect(screen.getByText('Save failed').className).toContain('sr-only');

    await user.click(trigger);
    expect(screen.getByRole('combobox', { name: 'Priority' })).toBeTruthy();
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });
  });

  it('closes the editor while a parent save is pending and does not reopen when it settles', async () => {
    const user = userEvent.setup();
    const editor = (
      <select aria-label="Priority" defaultValue="2">
        <option value="2">P2</option>
      </select>
    );
    const view = render(
      <EditableMetadata label="Priority for Launch plan" value="P2" editor={editor} />,
    );

    await user.click(screen.getByRole('button', { name: 'Priority for Launch plan' }));
    expect(screen.getByRole('combobox', { name: 'Priority' })).toBeTruthy();

    view.rerender(
      <EditableMetadata pending label="Priority for Launch plan" value="P2" editor={editor} />,
    );
    expect(screen.queryByRole('combobox', { name: 'Priority' })).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Priority for Launch plan' }).hasAttribute('disabled'),
    ).toBe(true);

    view.rerender(<EditableMetadata label="Priority for Launch plan" value="P2" editor={editor} />);
    expect(screen.queryByRole('combobox', { name: 'Priority' })).toBeNull();
  });

  it('cancels date drafts on Escape and commits them with Enter', async () => {
    const user = userEvent.setup();
    const apply = vi.fn();
    render(
      <EditableMetadata
        label="Due date for Launch plan"
        value="Jul 1"
        editor={<MetadataDateEditor defaultValue="2026-07-01" onApply={apply} />}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Due date for Launch plan' });
    await user.click(trigger);
    const input = screen.getByLabelText('Due date');
    await user.clear(input);
    await user.type(input, '2026-07-04');
    await user.keyboard('{Escape}');
    expect(apply).not.toHaveBeenCalled();

    await user.click(trigger);
    const restoredInput = screen.getByLabelText('Due date');
    expect(restoredInput.getAttribute('value')).toBe('2026-07-01');
    await user.clear(restoredInput);
    await user.type(restoredInput, '2026-07-04{Enter}');
    expect(apply).toHaveBeenCalledWith('2026-07-04');
  });
});
