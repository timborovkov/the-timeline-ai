import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { UndoToastButton } from '@/components/ui/undo-toast-button';

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
