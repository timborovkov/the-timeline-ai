import { cleanup, render, screen } from '@testing-library/react';
import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';

import { UndoToastButton } from '@/components/ui/undo-toast-button';
// Test environment: happy-dom

afterEach(() => {
  cleanup();
});

describe('UndoToastButton', () => {
  it('stays on the toast surface instead of an inverted fill', () => {
    const onClick = vi.fn();
    render(<UndoToastButton onClick={onClick} />);

    const button = screen.getByRole('button', { name: 'Undo' });
    expect(button.className).toContain('bg-surface-2');
    expect(button.className).toContain('text-fg');
    expect(button.className).toContain('border-border');
    button.click();
    expect(onClick).toHaveBeenCalledOnce();
  });
});
