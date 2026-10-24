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

  it('renders plan, progress, and overage when expanded', () => {
    const html = renderToStaticMarkup(<SidebarBillingUsage summary={summary} expanded />);
    expect(html).toContain('data-sidebar-billing');
    expect(html).toContain('Pay as you go');
    expect(html).toContain('72%');
    expect(html).toContain('€18 of €25');
    expect(html).toContain('+€4.20 overage');
    expect(html).toContain('href="/app/team?section=billing"');
  });

  it('renders a compact control when collapsed', () => {
    const html = renderToStaticMarkup(<SidebarBillingUsage summary={summary} expanded={false} />);
    expect(html).toContain('data-sidebar-billing');
    expect(html).toContain('Open billing');
    expect(html).toContain('size-9');
    expect(html).not.toContain('>72%<');
  });
});
