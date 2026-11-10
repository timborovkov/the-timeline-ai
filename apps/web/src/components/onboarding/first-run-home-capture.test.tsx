import { expect, vi } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';
// Test environment: happy-dom

const fakes = vi.hoisted(() => ({
  refresh: vi.fn(),
}));

await vi.mock(
  import.meta.resolve('next/navigation'),
  () => ({
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
  it('lets the owner wait on Home while capture is still reading', () => {
    render(<FirstRunHomeCapture failed={false} />);

    expect(screen.getByText('Still reading what you brought')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to setup' }).getAttribute('href')).toBe(
      '/onboarding',
    );
  });

  it('offers another starter path after a failed capture', () => {
    render(<FirstRunHomeCapture failed />);

    expect(screen.getByText('We could not finish that capture')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Choose another way' }).getAttribute('href')).toBe(
      '/onboarding',
    );
  });
});
