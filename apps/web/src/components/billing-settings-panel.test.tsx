import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { CheapestPlanPreview } from '@timeline/shared/billing/preview';

import {
  BillingSettingsPanel,
  type BillingSettingsPanelProps,
} from '@/components/billing-settings-panel';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock('@/app/actions/billing', () => ({
  startBillingCheckout: vi.fn(),
  startBillingPortal: vi.fn(),
  updateBillingSpendCap: vi.fn(),
}));

const planPreview: CheapestPlanPreview = {
  recommended: 'payg',
  bills: {
    payg: {
      planId: 'payg',
      platformFeeCents: 0,
      extraMemberCents: 0,
      meteredAfterDiscountCents: 0,
      totalCents: 0,
    },
    team: {
      planId: 'team',
      platformFeeCents: 4900,
      extraMemberCents: 0,
      meteredAfterDiscountCents: 0,
      totalCents: 4900,
    },
    business: {
      planId: 'business',
      platformFeeCents: 19900,
      extraMemberCents: 0,
      meteredAfterDiscountCents: 0,
      totalCents: 19900,
    },
  },
};

function panel(overrides: Partial<BillingSettingsPanelProps> = {}): string {
  return renderToStaticMarkup(
    <BillingSettingsPanel
      planId="free"
      planName="Free"
      billingState="free"
      shadowBilling
      spendCapCents={0}
      includedDiscountRemainingCents={0}
      meteredSpendCents={0}
      periodYm="2026-10"
      meters={{}}
      capacityUsage={[]}
      utilization={{
        spendCapCents: 0,
        meteredSpendCents: 0,
        percent: null,
        warnLevel: null,
      }}
      freeRemaining={{
        aiChargeCents: 500,
        recallMinutes: 60,
        emailUnits: 500,
        storageGb: 1,
        acceptedSources: 1000,
      }}
      nudge={null}
      costBearingPaused={false}
      polarConfigured
      hasPolarSubscription={false}
      canManage
      planPreview={planPreview}
      activeMemberCount={1}
      comp={null}
      priceNotice={null}
      showOperatorLink={false}
      {...overrides}
    />,
  );
}

describe('BillingSettingsPanel collection copy', () => {
  it('offers PAYG checkout that saves a card for monthly invoicing', () => {
    const html = panel();
    expect(html).toContain('Pay as you go');
    expect(html).toContain('€0 Polar subscription');
    expect(html).toContain('Checkout saves the card');
    expect(html).toContain('invoiced monthly');
    expect(html).toContain('Monthly Polar invoice on the card on file');
    expect(html).not.toContain('Top up');
    expect(html).not.toContain('Auto-reload');
    expect(html).not.toContain('Wallet');
  });

  it('keeps checkout available for the current plan until a Polar subscription exists', () => {
    function planButton(html: string, label: string): string {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
      const match = new RegExp(`<button[^>]*>${escaped}</button>`, 'u').exec(html);
      return match?.[0] ?? '';
    }
    const open = panel({ planId: 'payg', planName: 'Pay as you go', hasPolarSubscription: false });
    expect(planButton(open, 'Pay as you go')).not.toContain('disabled=""');
    const subscribed = panel({
      planId: 'payg',
      planName: 'Pay as you go',
      hasPolarSubscription: true,
    });
    expect(planButton(subscribed, 'Pay as you go')).toContain('disabled=""');
    expect(planButton(subscribed, 'Team · €49/mo')).not.toContain('disabled=""');
  });

  it('turns checkout off on a comp without the enterprise message', () => {
    const html = panel({
      planId: 'team',
      planName: 'Team',
      comp: {
        planName: 'Team',
        expired: false,
        reason: 'internal',
        expiresOn: null,
      },
    });
    expect(html).toContain('Polar checkout is turned off while this workspace is comped');
    expect(html).not.toContain('Enterprise plan changes');
    expect(html).not.toContain('Assign comp');
  });

  it('shows the past_due pause and a payment-method update', () => {
    const html = panel({
      planId: 'payg',
      planName: 'Pay as you go',
      billingState: 'past_due',
      shadowBilling: false,
      costBearingPaused: true,
    });
    expect(html).toContain('Payment failed');
    expect(html).toContain('New cost-bearing work is paused');
    expect(html).toContain('Update payment method');
    expect(html).not.toContain('Top up');
    expect(html).not.toContain('Auto-reload');
  });
});
