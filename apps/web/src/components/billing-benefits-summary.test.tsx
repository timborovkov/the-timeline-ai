import { buildBillingPresentation } from '@timeline/shared/billing';
import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { BillingBenefitsSummary } from '@/components/billing-benefits-summary';

function fixture(
  planId: 'free' | 'payg' | 'team' | 'business' | 'enterprise' = 'team',
  comped = false,
) {
  return buildBillingPresentation({
    account: {
      planId,
      billingState: 'team_active',
      arrangement: comped ? 'comped' : 'standard',
      includedDiscountRemainingCents: planId === 'team' ? 4500 : 0,
      periodStartedAt: new Date('2026-10-15'),
      periodEndsAt: new Date('2026-11-15'),
      spendCapCents: 10000,
    },
    now: new Date('2026-10-20'),
    meters: {},
    activeMembers: 12,
    shadowBilling: false,
    meteredSpendCents: 2000,
    settlements: [
      {
        operationId: 'synthetic',
        meterId: 'ai',
        nativeUnits: '2000',
        billable: true,
        occurredAt: new Date('2026-10-20'),
        metadata: { usage_at: '2026-10-20T00:00:00Z', discount_cents: 1500, invoice_cents: 500 },
      },
    ],
  });
}
describe('BillingBenefitsSummary', () => {
  it('shows shared credit, actual recorded charges, separate fee, members and cap periods', () => {
    const html = renderToStaticMarkup(<BillingBenefitsSummary summary={fixture()} />);
    for (const text of [
      'Included usage credit',
      '€60',
      '€45',
      '15 Oct 2026',
      '14 Nov 2026',
      'Charges recorded so far',
      '€5',
      'Recurring plan fee',
      '€49',
      'Members: 12 current',
      'before included credit',
      '1 Oct 2026',
      '31 Oct 2026',
    ])
      expect(html).toContain(text);
    expect(html).not.toContain('Next invoice');
    expect(html).toContain('sm:grid-cols-3');
  });
  it('shows updating or unavailable rather than invented charges', () => {
    const summary = fixture();
    summary.credit.status = 'updating';
    summary.charges = { status: 'unavailable', period: summary.charges.period, amounts: null };
    const html = renderToStaticMarkup(<BillingBenefitsSummary summary={summary} />);
    expect(html).toContain('Updating billing period');
    expect(html).toContain('Unavailable');
    expect(html).not.toContain('Total recorded usage charges');
  });
  it('explains PAYG resets and keeps comp and Enterprise fees honest', () => {
    const payg = renderToStaticMarkup(<BillingBenefitsSummary summary={fixture('payg')} />);
    expect(payg).toContain('Monthly allowances reset 1 Nov 2026');
    expect(payg).toContain('Usage above Free allowances');
    expect(payg).toContain('not credit or an upfront charge');
    const comp = renderToStaticMarkup(<BillingBenefitsSummary summary={fixture('team', true)} />);
    expect(comp).toContain('No new Polar usage charges');
    expect(comp).not.toContain('€49');
    expect(
      renderToStaticMarkup(<BillingBenefitsSummary summary={fixture('enterprise')} />),
    ).toContain('Custom');
  });
});

it('shows contractual Enterprise limits without a false local pause, while retaining comp enforcement', () => {
  const contract = fixture('enterprise');
  expect(contract.cap.applicable).toBe(false);
  const html = renderToStaticMarkup(<BillingBenefitsSummary summary={contract} />);
  expect(html).toContain('no local spend cap applies');
  expect(html).not.toContain('usage is paused');
  const comp = fixture('enterprise', true);
  comp.cap.limitCents = 0;
  expect(comp.cap.applicable).toBe(true);
  expect(renderToStaticMarkup(<BillingBenefitsSummary summary={comp} />)).toContain(
    'usage is paused at a €0 cap',
  );
});
