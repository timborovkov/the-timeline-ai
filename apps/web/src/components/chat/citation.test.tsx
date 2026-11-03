import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';

import { CitationCopyChip } from '@/components/artifact-reference-chip';
import { CitationText } from '@/components/chat/citation';
// Test environment: happy-dom

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function previewPayload(eventId: string) {
  return {
    preview: {
      ref: { kind: 'timeline_event', id: eventId },
      title: 'Slack from Maya',
      subtitle: '#product · Aug 12, 2026, 9:12 AM',
      body: 'Keep the CSV fallback.',
      badges: ['Slack'],
      href: `/app/timeline?event=${eventId}#ev-${eventId}`,
      actions: [
        {
          href: `/app/timeline?event=${eventId}#ev-${eventId}`,
          label: 'Open on Timeline',
          primary: true,
        },
      ],
      card: {
        sourceKey: 'slack',
        sourceLabel: 'Slack',
        logoSrc: '/connectors/slack.svg',
        author: 'Maya',
        dateLabel: 'Aug 12, 2026, 9:12 AM',
        quote: 'Keep the CSV fallback.',
      },
    },
  };
}

describe('CitationText artifact references', () => {
  it('renders numbered superscripts instead of raw citation chips', () => {
    render(
      <CitationText
        text={`Refs [ev:${A}] [ent:${B}] [note:${C}] [doc:${A}#v2:chunk:${B}] [cal:${A}] [board:${B}] [board-item:${C}] [task:${A}] [route:team/invites]`}
      />,
    );

    expect(screen.getByRole('button', { name: 'Citation 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Citation 2' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Citation 9' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Open reference/ })).toBeNull();
    expect(screen.queryByText('[ev:aaaaaaaa]')).toBeNull();
  });

  it('reuses the first-appearance number when the same source is cited again', () => {
    render(<CitationText text={`Start [ev:${A}] then [ent:${B}] and [ev:${A}] again.`} />);

    const first = screen.getAllByRole('button', { name: 'Citation 1' });
    expect(first).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Citation 2' })).toBeTruthy();
    expect(first[0]?.textContent).toBe('1');
    expect(first[1]?.textContent).toBe('1');
  });

  it('accepts a shared numbering map from a parent message', () => {
    const numbers = new Map<string, number>([
      [`[ent:${B}]`, 1],
      [`[ev:${A}]`, 2],
    ]);
    render(<CitationText numbers={numbers} text={`Later part [ev:${A}].`} />);
    expect(screen.getByRole('button', { name: 'Citation 2' }).textContent).toBe('2');
    expect(screen.queryByRole('button', { name: 'Citation 1' })).toBeNull();
  });
});

describe('CitationText preview card', () => {
  it('opens the card on hover and keeps the existing source link', async () => {
    vi.stubGlobal(
      'matchMedia',
      (query: string) =>
        ({
          matches: query.includes('hover: hover'),
          media: query,
          onchange: null,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        }) as unknown as MediaQueryList,
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json(previewPayload(A)))),
    );

    render(<CitationText text={`Shipped [ev:${A}].`} />);
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Citation 1' }));

    expect(await screen.findByText('Maya')).toBeTruthy();
    expect(screen.getByText('Slack · Aug 12, 2026, 9:12 AM')).toBeTruthy();
    expect(screen.getByText('“Keep the CSV fallback.”')).toBeTruthy();
    const logo = document.querySelector('img[src="/connectors/slack.svg"]');
    expect(logo).toBeTruthy();
    expect(logo?.closest('span')?.className).toContain('bg-white');
    expect(screen.getByRole('link', { name: 'Open on Timeline' }).getAttribute('href')).toBe(
      `/app/timeline?event=${A}#ev-${A}`,
    );
  });

  it('opens on keyboard focus, closes on Escape, and labels the control', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json(previewPayload(A)))),
    );
    const user = userEvent.setup();
    render(<CitationText text={`Shipped [ev:${A}].`} />);

    await user.tab();
    const marker = screen.getByRole('button', { name: /^Citation 1/ });
    expect(marker.getAttribute('aria-expanded')).toBe('true');
    expect(marker.getAttribute('aria-haspopup')).toBe('dialog');
    expect(await screen.findByRole('dialog')).toBeTruthy();

    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(marker.getAttribute('aria-expanded')).toBe('false');
  });

  it('closes after a desktop click when the next dismissal is an outside click', async () => {
    vi.stubGlobal(
      'matchMedia',
      (query: string) =>
        ({
          matches: query.includes('hover: hover'),
          media: query,
          onchange: null,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        }) as unknown as MediaQueryList,
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json(previewPayload(A)))),
    );
    const user = userEvent.setup();
    render(
      <div>
        <CitationText text={`Shipped [ev:${A}].`} />
        <button type="button">Outside</button>
      </div>,
    );

    await user.click(screen.getByRole('button', { name: 'Citation 1' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Outside' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
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
