import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';
// Test environment: happy-dom

await vi.mock(
  import.meta.resolve('next/navigation'),
  () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  }),
  () => import('next/navigation'),
);
await vi.mock(
  import.meta.resolve('@/app/actions/first-run'),
  () => ({ setFirstRunPhaseAction: vi.fn(() => Promise.resolve({ ok: true })) }),
  () => import('@/app/actions/first-run'),
);

const { cleanup, render, screen } = await import('@testing-library/react');
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
});
