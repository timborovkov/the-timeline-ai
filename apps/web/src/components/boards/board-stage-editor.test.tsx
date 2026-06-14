// @vitest-environment happy-dom

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { BoardStageEditor, type EditableBoardStage } from '@/components/boards/board-stage-editor';

describe('BoardStageEditor', () => {
  it('renames, reorders, adds, and removes stages', async () => {
    const user = userEvent.setup();
    let stages: EditableBoardStage[] = [
      { id: 'lane-1', name: 'Backlog', kind: 'active' },
      { id: 'lane-2', name: 'Review', kind: 'active' },
      { id: 'lane-3', name: 'Done', kind: 'done' },
    ];
    const onChange = vi.fn((next: EditableBoardStage[]) => {
      stages = next;
      rerender(<BoardStageEditor stages={stages} onChange={onChange} />);
    });
    const { rerender } = render(<BoardStageEditor stages={stages} onChange={onChange} />);

    await user.clear(screen.getByLabelText('Stage 1 name'));
    await user.type(screen.getByLabelText('Stage 1 name'), 'Ideas');
    expect(stages[0]?.name).toBe('Ideas');

    await user.click(screen.getByRole('button', { name: 'Move Done up' }));
    expect(stages.map((stage) => stage.name)).toEqual(['Ideas', 'Done', 'Review']);

    await user.click(screen.getByRole('button', { name: 'Stage' }));
    expect(stages.map((stage) => stage.name)).toEqual(['Ideas', 'Done', 'Review', 'New stage']);

    await user.click(screen.getByRole('button', { name: 'Remove Done' }));
    expect(stages.map((stage) => stage.name)).toEqual(['Ideas', 'Review', 'New stage']);
  });
});
