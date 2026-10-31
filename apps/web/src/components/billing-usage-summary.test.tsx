import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

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

it('keeps all PAYG meters visible and separates included usage from chargeable spend', () => {
  const html = renderToStaticMarkup(
    <BillingUsageSummary
      planId="payg"
      spendCapCents={2500}
      meteredSpendCents={0}
      meters={{ ai: { nativeUnits: 1, customerChargeCents: 1, capEligibleChargeCents: 0 } }}
      capacityUsage={[]}
    />,
  );
  for (const meter of [
    'ai',
    'recall_minutes',
    'email_units',
    'storage_gb_month',
    'accepted_sources',
    'member_days',
  ]) {
    expect(html).toContain(`data-billing-meter="${meter}"`);
  }
  expect(html).toContain('Monthly spend cap:');
  expect(html).toContain('€25');
  expect(html).toContain('Included: €5');
  expect(html).toContain('Remaining: €4.99');
  expect(html).toContain('Included: 60 min');
  // Earlier Free AI usage retains its measured value but must not appear as a charge.
  expect(html.match(/€0\.01/g)).toHaveLength(2);
  expect(html).toContain('>€0</span>');
});

it('shows exhausted PAYG allowance and actual chargeable overage', () => {
  const html = renderToStaticMarkup(
    <BillingUsageSummary
      planId="payg"
      meters={{ ai: { nativeUnits: 600, customerChargeCents: 101, capEligibleChargeCents: 100 } }}
      capacityUsage={[]}
    />,
  );
  expect(html).toContain('Remaining: €0');
  expect(html).toContain('>€1<');
  expect(html).not.toContain('€1.01');
});

it('does not imply that Team has the PAYG native allowances', () => {
  const html = renderToStaticMarkup(
    <BillingUsageSummary planId="team" meters={{}} capacityUsage={[]} />,
  );
  expect(html).toContain('Meeting minutes');
  expect(html).not.toContain('Included: 60 min');
});

it('keeps comped usage visible without presenting tracked spend as a charge', () => {
  const html = renderToStaticMarkup(
    <BillingUsageSummary
      planId="team"
      comped
      meters={{ ai: { nativeUnits: 600, customerChargeCents: 600, capEligibleChargeCents: 600 } }}
      capacityUsage={[]}
    />,
  );
  expect(html).toContain('without Polar charges');
  expect(html.match(/€6/g)).toHaveLength(1);
});

it('preserves accrued paid charges after a downgrade to Free', () => {
  const html = renderToStaticMarkup(
    <BillingUsageSummary
      planId="free"
      meters={{ ai: { nativeUnits: 1000, customerChargeCents: 1000, capEligibleChargeCents: 500 } }}
      capacityUsage={[]}
    />,
  );
  expect(html).toContain('>€5</span>');
});
