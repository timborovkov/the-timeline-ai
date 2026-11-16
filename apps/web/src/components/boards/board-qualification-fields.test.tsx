import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect } from '@timeline/test-support';
import { it } from 'bun:test';

import { BoardQualificationFields } from '@/components/boards/board-qualification-fields';
import { EMPTY_BOARD_QUALIFICATION, type BoardQualificationDraft } from '@/lib/board-qualification';

// Users can opt in, learn from examples, and constrain manual membership independently.
it('guides opt-in criteria and preserves type restrictions when suggestions are disabled', async () => {
  const user = userEvent.setup();
  let value: BoardQualificationDraft = { ...EMPTY_BOARD_QUALIFICATION };
  const onChange = (next: BoardQualificationDraft) => {
    value = next;
    rerender(<BoardQualificationFields value={value} onChange={onChange} />);
  };
  const { rerender } = render(<BoardQualificationFields value={value} onChange={onChange} />);
  expect(screen.queryByRole('textbox')).toBeNull();
  await user.click(screen.getByRole('checkbox', { name: 'Restrict allowed object types' }));
  await user.click(screen.getByRole('checkbox', { name: /^person$/ }));
  await user.click(screen.getByRole('checkbox', { name: 'Suggest board changes' }));
  await user.click(screen.getByRole('button', { name: 'Prospects' }));
  expect(
    screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'What belongs here?' }).value,
  ).toContain('Exclude vendors');
  await user.click(screen.getByRole('checkbox', { name: 'Suggest board changes' }));
  expect(value.strictObjectTypes).toBe(true);
  expect(value.recommendedObjectTypes).toEqual(['person']);
  expect(value.qualificationInstructions).toContain('Exclude vendors');
  expect(screen.queryByRole('textbox')).toBeNull();
});
