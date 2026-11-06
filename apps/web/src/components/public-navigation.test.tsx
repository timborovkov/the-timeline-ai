import { readFileSync } from 'node:fs';

import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';

import navStyles from '@/components/public-navigation.module.css';
// Test environment: happy-dom

const NAV_STYLESHEET = readFileSync(
  new URL('./public-navigation.module.css', import.meta.url),
  'utf8',
);
const DROPDOWN_CHEVRON_CLASS = navStyles.dropdownChevron;
if (!DROPDOWN_CHEVRON_CLASS) {
  throw new Error('public-navigation stylesheet is missing dropdownChevron');
}

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
    ).toEqual(['Use cases', 'Integrations']);
  });

  it('opens Use cases and Integrations dropdowns, including on the mobile menu', async () => {
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

    await user.click(screen.getByText('Integrations'));
    expect(screen.getByRole('link', { name: 'Integrations hub' }).getAttribute('href')).toBe(
      '/integrations',
    );
    expect(screen.getByRole('link', { name: 'Slack · Native sync' }).getAttribute('href')).toBe(
      '/integrations/slack',
    );
    expect(screen.getByRole('link', { name: 'Telegram · Capture' }).getAttribute('href')).toBe(
      '/integrations/telegram',
    );
    expect(
      screen.getByRole('link', { name: 'Google Drive · Native sync' }).getAttribute('href'),
    ).toBe('/integrations/google-drive');
    expect(screen.getByRole('link', { name: 'GitHub · Native sync' }).getAttribute('href')).toBe(
      '/integrations/github',
    );
    expect(screen.getByRole('link', { name: 'Linear · Native sync' }).getAttribute('href')).toBe(
      '/integrations/linear',
    );
    expect(
      screen.getByRole('link', { name: 'Monday.com · Native sync' }).getAttribute('href'),
    ).toBe('/integrations/monday');
    expect(screen.getByRole('link', { name: 'Jira · MCP lookup' }).getAttribute('href')).toBe(
      '/integrations/jira',
    );
    expect(screen.getByRole('link', { name: 'Notion · MCP lookup' }).getAttribute('href')).toBe(
      '/integrations/notion',
    );
    expect(screen.queryByRole('link', { name: 'HubSpot · Coming soon' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Attio · Coming soon' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Pipedrive · Coming soon' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'The Timeline vs Day AI' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Compare hub' })).toBeNull();

    const menu = container.querySelector('details');
    const pricing = screen.getByRole('link', { name: 'Pricing' });
    pricing.addEventListener('click', (event) => {
      event.preventDefault();
    });
    await user.click(pricing);
    expect(menu?.open).toBe(false);
  });

  it('flips expandable mobile-nav chevrons from down when collapsed to up when expanded', async () => {
    const openChevronRule =
      /details\[open\]\s*>\s*summary\s+\.dropdownChevron\s*\{(?<body>[\s\S]*?)\n\}/u.exec(
        NAV_STYLESHEET,
      );
    expect(openChevronRule?.groups?.body).toContain('transform: rotate(180deg)');
    expect(NAV_STYLESHEET).not.toMatch(/group-open/);

    const sheet = document.createElement('style');
    sheet.textContent = NAV_STYLESHEET;
    document.head.append(sheet);

    const chevronTransform = (dropdown: HTMLDetailsElement | undefined) => {
      const chevron = dropdown?.querySelector('summary svg');
      return chevron ? getComputedStyle(chevron).transform : '';
    };

    try {
      const user = userEvent.setup();
      const { container } = render(<PublicNavigationDisclosure currentSection="product" />);
      await user.click(screen.getByText('Menu'));
      expect(container.querySelector('details')?.open).toBe(true);

      const dropdowns = [...container.querySelectorAll<HTMLDetailsElement>('nav details')];
      expect(
        dropdowns.map((dropdown) => dropdown.querySelector('summary')?.childNodes[0]?.textContent),
      ).toEqual(['Use cases', 'Integrations']);

      for (const dropdown of dropdowns) {
        expect(dropdown.open).toBe(false);
        const chevron = dropdown.querySelector('summary svg');
        expect(chevron?.classList.contains('lucide-chevron-down')).toBe(true);
        expect(chevron?.classList.contains(DROPDOWN_CHEVRON_CLASS)).toBe(true);
        expect(chevron?.className).not.toContain('group-open');
        expect(chevron?.className).not.toContain('rotate-180');
        expect(chevronTransform(dropdown)).not.toContain('180');
      }

      for (const name of ['Product', 'Agents', 'Pricing', 'Sign in'] as const) {
        const row = screen.getByRole('link', { name });
        expect(row.querySelector('svg.lucide-chevron-down') ?? null).toBeNull();
        expect(row.querySelector(`svg.${DROPDOWN_CHEVRON_CLASS}`) ?? null).toBeNull();
      }

      expect(dropdowns).toHaveLength(2);
      const useCases = dropdowns[0];
      const integrations = dropdowns[1];
      await user.click(screen.getByText('Use cases'));
      expect(useCases?.open).toBe(true);
      expect(integrations?.open).toBe(false);
      expect(chevronTransform(useCases)).toContain('rotate(180deg)');
      expect(chevronTransform(integrations)).not.toContain('180');
      expect(
        useCases?.querySelector('summary svg')?.classList.contains('lucide-chevron-down'),
      ).toBe(true);

      await user.click(screen.getByText('Use cases'));
      expect(useCases?.open).toBe(false);
      expect(chevronTransform(useCases)).not.toContain('180');
    } finally {
      sheet.remove();
    }
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
