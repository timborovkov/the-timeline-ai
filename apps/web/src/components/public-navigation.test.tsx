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

const { PublicNavigationDisclosure, PublicNavigationItems } =
  await import('@/components/public-navigation');

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

describe('Trust navigation', () => {
  it('places Trust after How it works and marks the active page', () => {
    render(<PublicNavigationItems currentSection="trust" />);
    const links = screen.getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual([
      'Product',
      'Integrations',
      'How it works',
      'Trust',
      'Help',
    ]);
    expect(screen.getByRole('link', { name: 'Trust' }).getAttribute('href')).toBe('/trust');
    expect(screen.getByRole('link', { name: 'Trust' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Help' }).hasAttribute('aria-current')).toBe(false);
  });

  it('closes the mobile disclosure when Trust is activated by keyboard', async () => {
    const user = userEvent.setup();
    const { container } = render(<PublicNavigationDisclosure currentSection="trust" />);
    await user.click(screen.getByText('Menu'));
    const link = screen.getByRole('link', { name: 'Trust' });
    link.addEventListener('click', (event) => {
      event.preventDefault();
    });
    link.focus();
    await user.keyboard('{Enter}');
    expect(container.querySelector('details')?.open).toBe(false);
  });
});
