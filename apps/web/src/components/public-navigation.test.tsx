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

const { cleanup, render, screen, within } = await import('@testing-library/react');
const { default: userEvent } = await import('@testing-library/user-event');

const { PublicFooterColumns, PublicNavigationDisclosure, PublicNavigationItems } =
  await import('@/components/public-navigation');
const { resetPublicSessionCache, setPublicSessionCache } = await import('@/lib/public-session');

beforeEach(() => {
  route.pathname = '/help/article';
  resetPublicSessionCache();
});

afterEach(() => {
  cleanup();
  resetPublicSessionCache();
});

describe('PublicNavigationDisclosure', () => {
  it('closes after a menu link is activated', async () => {
    const user = userEvent.setup();
    const { container } = render(<PublicNavigationDisclosure currentSection="help" />);
    const disclosure = container.querySelector('details');

    await user.click(screen.getByLabelText('Menu'));
    expect(disclosure?.open).toBe(true);

    const pricingLink = screen.getByRole('link', { name: 'Pricing' });
    pricingLink.addEventListener('click', (event) => {
      event.preventDefault();
    });
    await user.click(pricingLink);

    expect(disclosure?.open).toBe(false);
  });

  it('closes with Escape and returns focus to the menu trigger', async () => {
    const user = userEvent.setup();
    const { container } = render(<PublicNavigationDisclosure currentSection="help" />);
    await user.click(screen.getByLabelText('Menu'));
    screen.getByRole('link', { name: 'Pricing' }).focus();
    await user.keyboard('{Escape}');
    expect(container.querySelector('details')?.open).toBe(false);
    expect(document.activeElement).toBe(container.querySelector('summary'));
  });

  it('closes when a persistent layout observes a pathname change', async () => {
    const user = userEvent.setup();
    const { container, rerender } = render(<PublicNavigationDisclosure currentSection="help" />);
    const disclosure = container.querySelector('details');

    await user.click(screen.getByLabelText('Menu'));
    expect(disclosure?.open).toBe(true);

    route.pathname = '/help';
    rerender(<PublicNavigationDisclosure currentSection="help" />);

    expect(disclosure?.open).toBe(false);
  });
});

describe('Header navigation', () => {
  it('shares Product and Resources groups and direct links across desktop and mobile', async () => {
    const { container } = render(<PublicNavigationItems currentSection="agents" />);
    expect(screen.getByRole('link', { name: 'Integrations' }).getAttribute('href')).toBe(
      '/integrations',
    );
    expect(screen.getByRole('link', { name: 'Pricing' }).getAttribute('href')).toBe('/pricing');
    expect(
      [...container.querySelectorAll('li > details > summary')].map((node) => node.textContent),
    ).toEqual(['Product', 'Resources']);
    cleanup();

    const user = userEvent.setup();
    render(<PublicNavigationDisclosure currentSection="product" />);
    await user.click(screen.getByLabelText('Menu'));
    await user.click(screen.getByText('Product'));
    for (const [name, href] of [
      ['How it works', '/how-it-works'],
      ['Product tour', '/product-tour'],
      ['Features', '/features'],
      ['For AI agents', '/agents'],
    ]) {
      expect(screen.getByRole('link', { name }).getAttribute('href')).toBe(href);
    }
    await user.click(screen.getByText('Resources'));
    for (const [name, href] of [
      ['Documentation', '/docs'],
      ['Guides', '/guides'],
      ['Security & privacy', '/trust'],
    ]) {
      expect(screen.getByRole('link', { name }).getAttribute('href')).toBe(href);
    }
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
      setPublicSessionCache({ status: 'signed-out' });
      const user = userEvent.setup();
      const { container } = render(<PublicNavigationDisclosure currentSection="product" />);
      await user.click(screen.getByLabelText('Menu'));
      expect(container.querySelector('details')?.open).toBe(true);

      const dropdowns = [...container.querySelectorAll<HTMLDetailsElement>('nav details')];
      expect(
        dropdowns.map((dropdown) => dropdown.querySelector('summary')?.childNodes[0]?.textContent),
      ).toEqual(['Product', 'Resources']);

      for (const dropdown of dropdowns) {
        expect(dropdown.open).toBe(false);
        const chevron = dropdown.querySelector('summary svg');
        expect(chevron?.classList.contains('lucide-chevron-down')).toBe(true);
        expect(chevron?.classList.contains(DROPDOWN_CHEVRON_CLASS)).toBe(true);
        expect(chevron?.className).not.toContain('group-open');
        expect(chevron?.className).not.toContain('rotate-180');
        expect(chevronTransform(dropdown)).not.toContain('180');
      }

      for (const name of ['Integrations', 'Pricing', 'Sign in'] as const) {
        const row = screen.getByRole('link', { name });
        expect(row.querySelector('svg.lucide-chevron-down') ?? null).toBeNull();
        expect(row.querySelector(`svg.${DROPDOWN_CHEVRON_CLASS}`) ?? null).toBeNull();
      }

      expect(dropdowns).toHaveLength(2);
      const product = dropdowns[0];
      const integrations = dropdowns[1];
      await user.click(screen.getByText('Product'));
      expect(product?.open).toBe(true);
      expect(integrations?.open).toBe(false);
      expect(chevronTransform(product)).toContain('rotate(180deg)');
      expect(chevronTransform(integrations)).not.toContain('180');
      expect(product?.querySelector('summary svg')?.classList.contains('lucide-chevron-down')).toBe(
        true,
      );

      await user.click(screen.getByText('Product'));
      expect(product?.open).toBe(false);
      expect(chevronTransform(product)).not.toContain('180');
    } finally {
      sheet.remove();
    }
  });

  it('keeps a quieter dropdown panel shadow and accessible focus/dismissal', async () => {
    expect(NAV_STYLESHEET).not.toMatch(/0 16px 40px/);
    expect(NAV_STYLESHEET).toMatch(/html\.dark\) \.dropdownPanel/);
    expect(NAV_STYLESHEET).toMatch(/details\[open\]\s*>\s*summary\s+\.dropdownChevron/);
    expect(NAV_STYLESHEET).toContain('.dropdownLink:hover');

    const user = userEvent.setup();
    const { container } = render(<PublicNavigationItems currentSection="product" />);
    const dropdowns = [...container.querySelectorAll<HTMLDetailsElement>('li details')];
    const integrations = dropdowns[1];
    expect(integrations).toBeTruthy();
    await user.click(screen.getByText('Resources'));
    expect(integrations?.open).toBe(true);
    expect(screen.getByRole('link', { name: 'Documentation' }).className).toContain(
      navStyles.dropdownLink,
    );

    await user.keyboard('{Escape}');
    expect(integrations?.open).toBe(false);
  });

  it('closes the mobile disclosure when Pricing is activated by keyboard', async () => {
    const user = userEvent.setup();
    const { container } = render(<PublicNavigationDisclosure currentSection="pricing" />);
    await user.click(screen.getByLabelText('Menu'));
    const link = screen.getByRole('link', { name: 'Pricing' });
    link.addEventListener('click', (event) => {
      event.preventDefault();
    });
    link.focus();
    await user.keyboard('{Enter}');
    expect(container.querySelector('details')?.open).toBe(false);
  });
});

describe('PublicFooterColumns', () => {
  it('lists Slack and Telegram in the Integrations column ahead of works-with pages', () => {
    render(<PublicFooterColumns />);

    const column = screen.getByRole('region', { name: 'Integrations' });
    const links = within(column)
      .getAllByRole('link')
      .map((link) => ({
        name: link.textContent,
        href: link.getAttribute('href'),
      }));

    expect(links.slice(0, 4)).toEqual([
      { name: 'Integrations hub', href: '/integrations' },
      { name: 'Slack · Native sync', href: '/integrations/slack' },
      { name: 'Telegram · Capture', href: '/integrations/telegram' },
      { name: 'Google Drive', href: '/integrations/google-drive' },
    ]);
    expect(links).toContainEqual({ name: 'GitHub', href: '/integrations/github' });
    expect(links).toContainEqual({ name: 'Linear', href: '/integrations/linear' });
    expect(links).toContainEqual({ name: 'Monday.com', href: '/integrations/monday' });
    expect(links).toContainEqual({ name: 'Sentry', href: '/integrations/sentry' });
    expect(links).toContainEqual({ name: 'Connect MCP tools', href: '/integrations/mcp' });
    expect(links.map((link) => link.href)).not.toContain('/integrations/jira');
    expect(links.map((link) => link.href)).toContain('/integrations/hubspot');
  });
});

it('dismisses the mobile menu on outside click and focus departure', async () => {
  const user = userEvent.setup();
  const { container } = render(
    <>
      <PublicNavigationDisclosure />
      <button>Outside</button>
    </>,
  );
  await user.click(screen.getByLabelText('Menu'));
  await user.click(screen.getByRole('button', { name: 'Outside' }));
  expect(container.querySelector('details')?.open).toBe(false);
  await user.click(screen.getByLabelText('Menu'));
  screen.getByRole('button', { name: 'Outside' }).focus();
  expect(container.querySelector('details')?.open).toBe(false);
});
it('marks the exact child route and closes same-route dropdown links', async () => {
  route.pathname = '/features';
  const user = userEvent.setup();
  const { container } = render(<PublicNavigationItems currentSection="features" />);
  await user.click(screen.getByText('Product'));
  const link = screen.getByRole('link', { name: 'Features' });
  expect(link.getAttribute('aria-current')).toBe('page');
  await user.click(link);
  expect(container.querySelector('details[open]')).toBeNull();
  cleanup();
  route.pathname = '/integrations/slack';
  render(<PublicFooterColumns currentSection="integrations" />);
  expect(
    screen.getByRole('link', { name: 'Integrations hub' }).getAttribute('aria-current'),
  ).toBeNull();
  expect(
    screen.getByRole('link', { name: 'Slack · Native sync' }).getAttribute('aria-current'),
  ).toBe('page');
});

describe('Guides footer navigation', () => {
  it('links Resources to the guides directory and marks the section active', () => {
    route.pathname = '/guides';
    render(<PublicFooterColumns currentSection="guides" />);
    const resources = screen.getByRole('region', { name: 'Resources' });
    const link = within(resources).getByRole('link', { name: 'Guides' });
    expect(link.getAttribute('href')).toBe('/guides');
    expect(link.getAttribute('aria-current')).toBe('page');
  });
});
