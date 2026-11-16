import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';
// Test environment: happy-dom

await vi.mock(
  import.meta.resolve('next/navigation'),
  () => ({
    usePathname: () => '/app/chat',
  }),
  () => import('next/navigation'),
);
await vi.mock(
  import.meta.resolve('@/app/actions/first-run'),
  () => ({ hideGettingStartedGuideAction: vi.fn(() => Promise.resolve({ ok: true })) }),
  () => import('@/app/actions/first-run'),
);

const { cleanup, render, screen } = await import('@testing-library/react');
const { GettingStartedStrip } = await import('./getting-started-strip.js');

afterEach(() => {
  cleanup();
});

describe('GettingStartedStrip', () => {
  it('shows the current guided step inside the real app chrome', () => {
    render(<GettingStartedStrip phase="ask" hidden={false} />);
    expect(screen.getByText('Getting started')).toBeTruthy();
    expect(screen.getByRole('link', { name: '2 Ask' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hide guide' })).toBeTruthy();
  });
});
