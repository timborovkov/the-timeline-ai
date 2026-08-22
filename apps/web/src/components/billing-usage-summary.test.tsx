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
  {
    kind: 'concurrent_recall_bots',
    label: 'Concurrent meeting notetakers',
    used: 1,
    limit: 1,
  },
  { kind: 'custom_mcp_servers', label: 'Custom MCP servers', used: 0, limit: 0 },
];

describe('BillingUsageSummary', () => {
  it('renders live plan stock next to meters', () => {
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
    expect(html).toContain('data-capacity-kind="concurrent_recall_bots"');
    expect(html).toContain('12 of 100');
    expect(html).toContain('1 of 1');
    expect(html).toContain('Not included');
    expect(html).toContain('Plan limits');
  });
});
