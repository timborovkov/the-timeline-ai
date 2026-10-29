import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';
// Test environment: happy-dom

const route = vi.hoisted(() => ({ pathname: '/help/article' }));

await vi.mock(
  import.meta.resolve('next/navigation'),
  async () => ({
    ...(await import('next/navigation')),
    usePathname: () => route.pathname,
  }),
  () => import('next/navigation'),
);

const { cleanup, render, screen } = await import('@testing-library/react');
const { default: userEvent } = await import('@testing-library/user-event');

const { PublicNavigationDisclosure } = await import('@/components/public-navigation');

beforeEach(() => {
  route.pathname = '/help/article';
});

afterEach(cleanup);

describe('PublicNavigationDisclosure', () => {
  it('closes after a menu link is activated', async () => {
    const user = userEvent.setup();
    const { container } = render(<PublicNavigationDisclosure currentSection="help" />);
    const disclosure = container.querySelector('details');

    await user.click(screen.getByText('Menu'));
    expect(disclosure?.open).toBe(true);

    const helpLink = screen.getByRole('link', { name: 'Help' });
    helpLink.addEventListener('click', (event) => {
      event.preventDefault();
    });
    await user.click(helpLink);

    expect(disclosure?.open).toBe(false);
  });

  it('closes when a persistent layout observes a pathname change', async () => {
    const user = userEvent.setup();
    const { container, rerender } = render(<PublicNavigationDisclosure currentSection="help" />);
    const disclosure = container.querySelector('details');

    await user.click(screen.getByText('Menu'));
    expect(disclosure?.open).toBe(true);

    route.pathname = '/help';
    rerender(<PublicNavigationDisclosure currentSection="help" />);

    expect(disclosure?.open).toBe(false);
  });
});
