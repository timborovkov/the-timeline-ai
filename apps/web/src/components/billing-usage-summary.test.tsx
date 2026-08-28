import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { PlanCapacityUsageRow } from '@timeline/shared/billing/status';

import { BillingUsageSummary } from '@/components/billing-usage-summary';

const utilization = {
  spendCapCents: 0,
  meteredSpendCents: 0,
  percent: null,
  warnLevel: null,
};

const freeRemaining = {
  aiChargeCents: 500,
  recallMinutes: 60,
  emailUnits: 500,
  storageGb: 1,
  acceptedSources: 1_000,
};

const capacityUsage: PlanCapacityUsageRow[] = [
  { kind: 'agent_turns', label: 'Ask turns', used: 12, limit: 100 },
  { kind: 'indexed_chunks', label: 'Indexed chunks', used: 23, limit: 50_000 },
  { kind: 'custom_mcp_servers', label: 'Custom MCP servers', used: 0, limit: 0 },
];

describe('BillingUsageSummary', () => {
  it('keeps infrastructure ceilings in a closed disclosure', () => {
    const html = renderToStaticMarkup(
      <BillingUsageSummary
        periodYm="2026-08"
        planName="Free"
        planId="free"
        utilization={utilization}
        freeRemaining={freeRemaining}
        meteredSpendCents={0}
        meters={{}}
        capacityUsage={capacityUsage}
        costBearingPaused={false}
      />,
    );
    expect(html).toContain('data-billing-capacity');
    expect(html).toContain('Infrastructure limits');
    expect(html).not.toMatch(/<details[^>]*\sopen/);
    expect(html).toContain('data-capacity-kind="indexed_chunks"');
    expect(html).toContain('23 of 50,000');
    expect(html).toContain('Not included');
    expect(html).not.toContain('Plan limits');
  });
});
