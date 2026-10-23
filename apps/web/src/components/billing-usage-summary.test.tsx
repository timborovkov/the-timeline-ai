import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { PlanCapacityUsageRow } from '@timeline/shared/billing/status';

import { BillingUsageSummary } from '@/components/billing-usage-summary';

const capacityUsage: PlanCapacityUsageRow[] = [
  { kind: 'agent_turns', label: 'Ask turns', used: 12, limit: 100 },
  { kind: 'indexed_chunks', label: 'Indexed chunks', used: 23, limit: 50_000 },
  { kind: 'custom_mcp_servers', label: 'Custom MCP servers', used: 0, limit: 0 },
];

describe('BillingUsageSummary', () => {
  it('keeps infrastructure ceilings in a closed disclosure', () => {
    const html = renderToStaticMarkup(
      <BillingUsageSummary planId="free" meters={{}} capacityUsage={capacityUsage} />,
    );
    expect(html).toContain('data-billing-capacity');
    expect(html).toContain('Infrastructure limits');
    expect(html).not.toMatch(/<details[^>]*\sopen/);
    expect(html).toContain('data-capacity-kind="indexed_chunks"');
    expect(html).toContain('23 of 50,000');
    expect(html).toContain('Not included');
    expect(html).not.toContain('Plan limits');
    expect(html).toContain('data-billing-meter="ai"');
    expect(html).not.toContain('Plan capacity ceilings');
  });

  it('shows meter, amount, and cost without member-day math', () => {
    const html = renderToStaticMarkup(
      <BillingUsageSummary
        planId="team"
        meters={{
          ai: { nativeUnits: 12, customerChargeCents: 12 },
          member_days: { nativeUnits: 3, customerChargeCents: 19 },
        }}
        capacityUsage={[]}
        includedActiveMembers={2}
        additionalMemberCents={500}
      />,
    );
    expect(html).toContain('data-billing-extra-members');
    expect(html).toContain('Extra members');
    expect(html).toContain('2 included');
    expect(html).toContain('€5 each');
    expect(html).toContain('€0.19');
    expect(html).toContain('AI');
    expect(html).toContain('€0.12');
    expect(html).not.toContain('Member-days');
    expect(html).not.toContain('extra member-day');
    expect(html).not.toContain('When charges are live');
    expect(html).not.toContain('Comped workspaces');
  });
});
