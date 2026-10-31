import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import type { CheapestPlanPreview, SelfServePaidPlanId } from '@timeline/shared/billing/preview';

import { BillingPlanPreview } from '@/components/billing-plan-preview';

function preview(input: {
  recommended: SelfServePaidPlanId;
  payg: number;
  team: number;
  business: number;
}): CheapestPlanPreview {
  const bill = (planId: SelfServePaidPlanId, totalCents: number) => ({
    planId,
    platformFeeCents: 0,
    extraMemberCents: 0,
    meteredAfterDiscountCents: totalCents,
    totalCents,
  });
  return {
    recommended: input.recommended,
    bills: {
      payg: bill('payg', input.payg),
      team: bill('team', input.team),
      business: bill('business', input.business),
    },
  };
}

function renderPreview(planPreview: CheapestPlanPreview, currentPlanId: string): string {
  return renderToStaticMarkup(
    <BillingPlanPreview preview={planPreview} currentPlanId={currentPlanId} />,
  );
}

describe('BillingPlanPreview', () => {
  it('hides the section when the current plan is already cheapest', () => {
    const html = renderPreview(
      preview({ recommended: 'payg', payg: 4_000, team: 4_900, business: 19_900 }),
      'payg',
    );
    expect(html).toBe('');
    expect(html).not.toContain('Cheapest plan this period');
    expect(html).not.toContain('currently the cheapest');
  });

  it('hides the section for a tiny saving', () => {
    const html = renderPreview(
      preview({ recommended: 'team', payg: 2_000, team: 1_600, business: 19_900 }),
      'payg',
    );
    expect(html).toBe('');
  });

  it('renders the section when the saving is at least €5 and 10%', () => {
    const html = renderPreview(
      preview({ recommended: 'team', payg: 10_000, team: 8_000, business: 19_900 }),
      'payg',
    );
    expect(html).toContain('data-billing-plan-hint');
    expect(html).toContain('Team would save €20 this month.');
    expect(html).not.toContain('Cheapest plan this period');
    expect(html).not.toContain('currently the cheapest');
  });
});
