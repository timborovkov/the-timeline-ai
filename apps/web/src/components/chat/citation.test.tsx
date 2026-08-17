// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CitationCopyChip } from '@/components/artifact-reference-chip';
import { CitationText } from '@/components/chat/citation';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

afterEach(() => {
  cleanup();
});

describe('CitationText artifact references', () => {
  it('renders every supported citation kind as a preview chip', () => {
    render(
      <CitationText
        text={`Refs [ev:${A}] [ent:${B}] [note:${C}] [doc:${A}#v2:chunk:${B}] [cal:${A}] [board:${B}] [board-item:${C}] [task:${A}] [route:team/invites]`}
      />,
    );

    for (const label of [
      '[ev:aaaaaaaa]',
      '[ent:bbbbbbbb]',
      '[note:cccccccc]',
      '[doc:aaaaaaaa#v2]',
      '[cal:aaaaaaaa]',
      '[board:bbbbbbbb]',
      '[board-item:cccccccc]',
      '[task:aaaaaaaa]',
      '[route:team/invites]',
    ]) {
      expect(screen.getByRole('button', { name: `Open reference ${label}` })).toBeTruthy();
    }
  });
});

describe('CitationCopyChip', () => {
  it('copies the full timeline event citation without opening a preview', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(<CitationCopyChip refValue={{ kind: 'timeline_event', id: A }} />);

    const chip = screen.getByRole('button', { name: 'Copy citation [ev:aaaaaaaa]' });
    expect(chip.textContent).toContain('[ev:aaaaaaaa]');
    fireEvent.click(chip);
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(`[ev:${A}]`);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
