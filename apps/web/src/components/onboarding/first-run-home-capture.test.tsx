import { expect, vi } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';
// Test environment: happy-dom

const fakes = vi.hoisted(() => ({
  refresh: vi.fn(),
}));

await vi.mock(
  import.meta.resolve('next/navigation'),
  () => ({
    redirect: vi.fn(),
    useRouter: () => ({ refresh: fakes.refresh, push: vi.fn() }),
  }),
  () => import('next/navigation'),
);

const { cleanup, render, screen } = await import('@testing-library/react');
const { FirstRunHomeCapture } = await import('./first-run-home-capture.js');

afterEach(() => {
  cleanup();
});

describe('FirstRunHomeCapture', () => {
  const capture = {
    ready: false,
    failed: false,
    emailWaiting: false,
    startedAt: new Date('2026-03-29T19:00:00Z'),
    completed: 1,
    total: 4,
    href: '/onboarding?capture=fixture',
  };

  it('links to the active capture and shows progress while Home remains usable', () => {
    render(<FirstRunHomeCapture {...capture} />);

    expect(screen.getByText('Your first capture is processing')).toBeTruthy();
    expect(screen.getByText('1 of 4 steps complete')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View capture status' }).getAttribute('href')).toBe(
      capture.href,
    );
  });

  it('keeps the same link after the capture is ready', () => {
    render(<FirstRunHomeCapture {...capture} ready />);

    expect(screen.getByText('Your first record is ready')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open your first record' }).getAttribute('href')).toBe(
      capture.href,
    );
  });
});
