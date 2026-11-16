import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';
// Test environment: happy-dom

const fakes = vi.hoisted(() => ({
  refresh: vi.fn(),
  push: vi.fn(),
  save: vi.fn(() => Promise.resolve({ ok: true, error: undefined as string | undefined })),
}));

await vi.mock(
  import.meta.resolve('next/navigation'),
  () => ({
    useRouter: () => ({ push: fakes.push, replace: vi.fn(), refresh: fakes.refresh }),
  }),
  () => import('next/navigation'),
);
await vi.mock(
  import.meta.resolve('@/app/actions/first-run'),
  () => ({ setFirstRunPhaseAction: fakes.save }),
  () => import('@/app/actions/first-run'),
);

const { cleanup, render, screen, fireEvent, waitFor } = await import('@testing-library/react');
const { FirstRecordScreen } = await import('./first-record-screen.js');

afterEach(() => {
  cleanup();
});

describe('FirstRecordScreen', () => {
  it('shows cited sources and pending suggestion pills', () => {
    render(
      <FirstRecordScreen
        title="seed-deck.pdf"
        meta="Document · uploaded"
        summary="The deck names Northwind as a pilot client."
        note="A document is a snapshot. The record starts updating itself once a channel or your email is connected."
        sources={[{ n: 1, kind: 'Document', title: 'Pilots', meta: 'chunk 1' }]}
        suggestions={[
          {
            id: 's1',
            type: 'Company',
            title: 'Northwind',
            detail: 'Pilot client',
            sourceN: 1,
            status: 'pending',
          },
        ]}
      />,
    );

    expect(screen.getByRole('heading', { name: 'seed-deck.pdf' })).toBeTruthy();
    expect(screen.getByText('Suggested · needs your approval')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ask about it' })).toBeTruthy();
  });

  it('cites only source numbers that are listed', () => {
    render(
      <FirstRecordScreen
        title="Starter context from studio.example"
        meta="Website · 2 pages read"
        summary="The about page names Dana Reyes as founder and lists Northwind as a client."
        note="This is your public website, not your team’s work yet."
        sources={[
          { n: 1, kind: 'Web page', title: 'Studio', meta: 'studio.example' },
          { n: 2, kind: 'Web page', title: 'About', meta: 'studio.example' },
        ]}
        suggestions={[
          {
            id: 's1',
            type: 'Company',
            title: 'Northwind',
            detail: 'Named client',
            sourceN: 2,
            status: 'pending',
          },
          {
            id: 's2',
            type: 'Person',
            title: 'Orphan cite',
            detail: 'Should not invent a third page',
            sourceN: 3,
            status: 'pending',
          },
        ]}
      />,
    );

    const northwind = screen.getByText('Northwind').closest('li');
    expect(northwind?.textContent).toContain('from');
    expect(northwind?.textContent).toContain('About');
    const orphan = screen.getByText('Orphan cite').closest('li');
    expect(orphan?.textContent).not.toContain('from');
    expect(orphan?.textContent).not.toContain('3');
  });
});

it('lets users check for suggestions after the starter record arrives', () => {
  render(
    <FirstRecordScreen
      title="Starter email"
      meta="Email"
      summary="Kickoff"
      note=""
      sources={[]}
      suggestions={[]}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Check for suggestions' }));
  expect(fakes.refresh).toHaveBeenCalledTimes(1);
});

it('stays on the record when saving progress fails', async () => {
  fakes.push.mockClear();
  fakes.save.mockResolvedValueOnce({ ok: false, error: 'Please try again.' });
  render(
    <FirstRecordScreen
      title="Starter email"
      meta="Email"
      summary="A pilot update"
      note=""
      sources={[]}
      suggestions={[]}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Ask about it' }));
  await waitFor(() => {
    expect(screen.getByRole('alert').textContent).toBe('Please try again.');
  });
  expect(fakes.push).not.toHaveBeenCalled();
});
