import { expect, vi } from '@timeline/test-support';
import { describe, it } from 'bun:test';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { WorkspaceTimezoneProvider } from '@/components/workspace-timezone-context';

await vi.mock(
  import.meta.resolve('@/components/ui/tooltip'),
  () => ({
    Tooltip: ({ children }: { children: ReactNode }) => children,
    TooltipContent: ({ children }: { children: ReactNode }) => <span>{children}</span>,
    TooltipTrigger: ({ children }: { children: ReactNode }) => children,
  }),
  () => import('@/components/ui/tooltip'),
);

const { SidebarBillingUsage } = await import('@/components/sidebar-billing-usage');

describe('SidebarBillingUsage', () => {
  const summary = {
    planId: 'payg' as const,
    planName: 'Pay as you go',
    progressPercent: 72,
    atLimit: false,
    detailLabel: '€18 of €25',
    overageLabel: '+€4.20 overage',
    overageCents: 420,
    href: '/app/team?section=billing',
    canManageBilling: true,
  };

  it('renders plan and spend when expanded', () => {
    const html = renderToStaticMarkup(<SidebarBillingUsage summary={summary} expanded />);
    expect(html).toContain('data-sidebar-billing');
    expect(html).toContain('Pay as you go');
    expect(html).toContain('€18 of €25');
    expect(html).not.toContain('>72%<');
    expect(html).not.toContain('+€4.20 overage');
    expect(html).toContain('href="/app/team?section=billing"');
  });

  it('hides the meter for members under the cap', () => {
    const html = renderToStaticMarkup(
      <SidebarBillingUsage
        summary={{ ...summary, canManageBilling: false, href: '/app/usage', atLimit: false }}
        expanded
      />,
    );
    expect(html).toBe('');
  });

  it('localizes the same UTC reset in the viewer and fallback time zones', () => {
    const resetAt = '2026-12-01T00:00:00.000Z';
    const resetSummary = {
      ...summary,
      planId: 'team' as const,
      planName: 'Team',
      detailLabel: '$1,234.56 cap',
      reset: { label: 'Usage resets', at: resetAt },
      resetLabel: 'Usage resets Dec 1 (UTC)',
    };
    const saved = renderToStaticMarkup(
      <WorkspaceTimezoneProvider
        timezone="America/Los_Angeles"
        region={{ locale: 'de-DE', timezone: 'Asia/Tokyo' }}
      >
        <SidebarBillingUsage summary={resetSummary} expanded />
        <SidebarBillingUsage summary={resetSummary} expanded={false} />
      </WorkspaceTimezoneProvider>,
    );
    const automatic = renderToStaticMarkup(
      <WorkspaceTimezoneProvider timezone="America/Los_Angeles" region={{ browserLocale: 'en-US' }}>
        <SidebarBillingUsage summary={resetSummary} expanded />
      </WorkspaceTimezoneProvider>,
    );

    expect(saved).toContain(`<time dateTime="${resetAt}">1. Dez., 09:00 GMT+9</time>`);
    expect(saved).toContain('Usage resets 1. Dez., 09:00 GMT+9');
    expect(saved).toContain('$1,234.56 cap');
    expect(automatic).toMatch(
      /<time dateTime="2026-12-01T00:00:00\.000Z">Nov 30(?:,| at) 4:00 PM PST<\/time>/,
    );
    expect(automatic).toMatch(/Usage resets Nov 30(?:,| at) 4:00 PM PST/);
  });

  it('shows only a cap notice for members at the cap', () => {
    const html = renderToStaticMarkup(
      <SidebarBillingUsage
        summary={{ ...summary, canManageBilling: false, href: '/app/usage', atLimit: true }}
        expanded
      />,
    );
    expect(html).toContain('Spend cap reached');
    expect(html).toContain('href="/app/usage"');
    expect(html).not.toContain('€18 of €25');
    expect(html).not.toContain('+€4.20 overage');
  });

  it('renders a compact control when collapsed', () => {
    const html = renderToStaticMarkup(<SidebarBillingUsage summary={summary} expanded={false} />);
    expect(html).toContain('data-sidebar-billing');
    expect(html).toContain('Open billing');
    expect(html).toContain('size-9');
    expect(html).not.toContain('>72%<');
  });
});
