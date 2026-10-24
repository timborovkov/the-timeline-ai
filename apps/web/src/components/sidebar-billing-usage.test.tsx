import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { ReactNode } from 'react';

import { SidebarBillingUsage } from '@/components/sidebar-billing-usage';

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipContent: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => children,
}));

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
