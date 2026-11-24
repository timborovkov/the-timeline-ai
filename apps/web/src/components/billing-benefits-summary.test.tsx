import { buildBillingPresentation } from '@timeline/shared/billing';
import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  BillingBenefitsSummary,
  BillingUsageOverview,
} from '@/components/billing-benefits-summary';
import { WorkspaceTimezoneProvider } from '@/components/workspace-timezone-context';

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
      'Oct 15, 2026',
      'Nov 14, 2026',
      'Charges recorded so far',
      '€5',
      'Recurring plan fee',
      '€49',
      'Members: 12 current',
      'before included credit',
      'Oct 1, 2026',
      'Oct 31, 2026',
    ])
      expect(html).toContain(text);
    expect(html).not.toContain('Next invoice');
    expect(html).toContain('sm:grid-cols-3');
  });
  it('explains when confirmed paid seats fall short of the full-member roster', () => {
    const summary = { ...fixture(), paidSeats: 10 };
    const html = renderToStaticMarkup(<BillingBenefitsSummary summary={summary} />);
    expect(html).toContain('12 full members · 10 paid seats');
    expect(html).toContain('The full-member count exceeds confirmed paid seats.');
    expect(
      renderToStaticMarkup(<BillingBenefitsSummary summary={{ ...summary, paidSeats: 12 }} />),
    ).not.toContain('The full-member count exceeds confirmed paid seats.');
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
    expect(payg).toContain('Monthly allowances reset');
    expect(payg).toContain('>Nov 1, 2026</time> (UTC)');
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

it('keeps credit and cap visible while charge details are collapsed on Usage', () => {
  const html = renderToStaticMarkup(
    <BillingUsageOverview summary={fixture()}>
      <p>Meters</p>
    </BillingUsageOverview>,
  );
  const beforeDetails = html.split('<details')[0];
  expect(beforeDetails).toContain('Included usage credit');
  expect(beforeDetails).toContain('Oct 15, 2026');
  expect(beforeDetails).toContain('€5');
  expect(html).toContain('Billing details');
  expect(html).not.toMatch(/<details[^>]*\sopen/);
  expect(html).toContain('Polar confirms the final invoice');
});
it('does not turn unavailable recorded charges into zero in the Usage overview', () => {
  const summary = fixture();
  summary.charges = { ...summary.charges, status: 'unavailable', amounts: null };
  const html = renderToStaticMarkup(
    <BillingUsageOverview summary={summary}>Meters</BillingUsageOverview>,
  );
  expect(html.split('<details')[0]).toContain('Unavailable');
});

it('localizes UTC billing dates without moving reset boundaries into the viewer time zone', () => {
  const html = renderToStaticMarkup(
    <WorkspaceTimezoneProvider
      timezone="Asia/Tokyo"
      region={{ locale: 'de-DE', timezone: 'America/Los_Angeles' }}
    >
      <BillingBenefitsSummary summary={fixture('payg')} />
    </WorkspaceTimezoneProvider>,
  );
  expect(html).toContain('<time dateTime="2026-11-01T00:00:00.000Z">01.11.2026</time> (UTC)');
});
