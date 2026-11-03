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

    const pricingLink = screen.getByRole('link', { name: 'Pricing' });
    pricingLink.addEventListener('click', (event) => {
      event.preventDefault();
    });
    await user.click(pricingLink);

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

describe('Header navigation', () => {
  it('keeps Product, Agents, and Pricing as top-level links', () => {
    const { container } = render(<PublicNavigationItems currentSection="agents" />);
    expect(screen.getByRole('link', { name: 'Product' }).getAttribute('href')).toBe('/');
    expect(screen.getByRole('link', { name: 'Agents' }).getAttribute('href')).toBe('/agents');
    expect(screen.getByRole('link', { name: 'Agents' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Pricing' }).getAttribute('href')).toBe('/pricing');
    expect(container.querySelectorAll(':scope > ul > li > details > summary').length).toBe(2);
    expect(
      [...container.querySelectorAll(':scope > ul > li > details > summary')].map(
        (node) => node.textContent,
      ),
    ).toEqual(['Use cases', 'Compare']);
  });

  it('opens Use cases and Compare dropdowns, including on the mobile menu', async () => {
    const user = userEvent.setup();
    const { container } = render(<PublicNavigationDisclosure currentSection="product" />);
    await user.click(screen.getByText('Menu'));

    const useCases = container.querySelector<HTMLDetailsElement>('nav details');
    expect(useCases?.open).toBe(false);
    await user.click(screen.getByText('Use cases'));
    expect(useCases?.open).toBe(true);
    expect(screen.getByRole('link', { name: 'All use cases' }).getAttribute('href')).toBe(
      '/use-cases',
    );
    expect(screen.getByRole('link', { name: 'Work record' }).getAttribute('href')).toBe(
      '/use-cases/work-record',
    );

    await user.click(screen.getByText('Compare'));
    expect(screen.getByRole('link', { name: 'Compare hub' }).getAttribute('href')).toBe('/compare');
    expect(screen.getByRole('link', { name: 'The Timeline vs Day AI' }).getAttribute('href')).toBe(
      '/compare/the-timeline-vs-day-ai',
    );
    expect(screen.getByRole('link', { name: 'Works with HubSpot' }).getAttribute('href')).toBe(
      '/integrations/hubspot',
    );
    expect(screen.getByRole('link', { name: 'Works with Linear' }).getAttribute('href')).toBe(
      '/integrations/linear',
    );

    const menu = container.querySelector('details');
    const pricing = screen.getByRole('link', { name: 'Pricing' });
    pricing.addEventListener('click', (event) => {
      event.preventDefault();
    });
    await user.click(pricing);
    expect(menu?.open).toBe(false);
  });

  it('closes the mobile disclosure when Pricing is activated by keyboard', async () => {
    const user = userEvent.setup();
    const { container } = render(<PublicNavigationDisclosure currentSection="pricing" />);
    await user.click(screen.getByText('Menu'));
    const link = screen.getByRole('link', { name: 'Pricing' });
    link.addEventListener('click', (event) => {
      event.preventDefault();
    });
    link.focus();
    await user.keyboard('{Enter}');
    expect(container.querySelector('details')?.open).toBe(false);
  });
});
