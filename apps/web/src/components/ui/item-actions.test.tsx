// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { ItemActionGroup, ItemOverflowMenu } from '@/components/ui/item-actions';

afterEach(() => {
  cleanup();
});

describe('ItemActionGroup', () => {
  it('labels row and footer action regions for their owning item', () => {
    render(
      <>
        <ItemActionGroup label="Actions for Acme renewal">
          <button type="button">Open</button>
        </ItemActionGroup>
        <ItemActionGroup label="Evidence actions for Telegram message" placement="footer">
          <button type="button">Team visibility</button>
        </ItemActionGroup>
      </>,
    );

    expect(screen.getByRole('group', { name: 'Actions for Acme renewal' })).toBeTruthy();
    expect(
      screen.getByRole('group', { name: 'Evidence actions for Telegram message' }),
    ).toBeTruthy();
  });
});

describe('ItemOverflowMenu', () => {
  it('uses the target label and restores trigger focus after Escape', async () => {
    const user = userEvent.setup();
    render(
      <ItemOverflowMenu targetLabel="Acme renewal">
        <DropdownMenuItem>Edit</DropdownMenuItem>
        <DropdownMenuItem className="text-destructive">Delete</DropdownMenuItem>
      </ItemOverflowMenu>,
    );

    const trigger = screen.getByRole('button', { name: 'Actions for Acme renewal' });
    await user.click(trigger);
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeTruthy();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menuitem', { name: 'Edit' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
