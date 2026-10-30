import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { expect, vi } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import type { BillingSettingsPanelProps } from '@/components/billing-settings-panel';
import type { CheapestPlanPreview } from '@timeline/shared/billing/preview';

await vi.mock(
  import.meta.resolve('next/navigation'),
  async () => ({
    ...(await import('next/navigation')),
    useRouter: () => ({ refresh: vi.fn() }),
  }),
  () => import('next/navigation'),
);

await vi.mock(
  import.meta.resolve('@/app/actions/billing'),
  () => ({
    startBillingCheckout: vi.fn(),
    startBillingPortal: vi.fn(),
    updateBillingSpendCap: vi.fn(),
  }),
  () => import('@/app/actions/billing'),
);

const { BillingSettingsPanel } = await import('@/components/billing-settings-panel');
const { startBillingCheckout } = await import('@/app/actions/billing');
afterEach(cleanup);

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

function panelElement(overrides: Partial<BillingSettingsPanelProps> = {}) {
  return (
    <BillingSettingsPanel
      planId="free"
      planName="Free"
      billingState="free"
      spendCapCents={0}
      meteredSpendCents={0}
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
      costBearingPaused={false}
      polarConfigured
      hasPolarSubscription={false}
      canManage
      planPreview={planPreview}
      comp={null}
      showOperatorLink={false}
      {...overrides}
    />
  );
}

function panel(overrides: Partial<BillingSettingsPanelProps> = {}): string {
  return renderToStaticMarkup(panelElement(overrides));
}

function invoiceBlock(html: string): string {
  const match = /data-billing-invoice[\s\S]*?<\/div>/u.exec(html);
  return match?.[0] ?? '';
}

function planButton(html: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const match = new RegExp(`<button[^>]*>${escaped}</button>`, 'u').exec(html);
  return match?.[0] ?? '';
}

describe('BillingSettingsPanel', () => {
  it('submits the promo field with the selected plan and displays server errors', async () => {
    vi.mocked(startBillingCheckout).mockResolvedValueOnce({
      ok: false,
      error: 'That discount is not eligible.',
    });
    const view = render(panelElement());
    fireEvent.change(view.getByLabelText('Promo code'), { target: { value: 'SYNTHETIC' } });
    fireEvent.click(view.getByText('Team · €49/mo'));
    await waitFor(() => {
      expect(startBillingCheckout).toHaveBeenCalledWith({
        plan: 'team',
        discountCode: 'SYNTHETIC',
      });
      expect(view.getByRole('alert').textContent).toBe('That discount is not eligible.');
    });
  });

  it('shows a promo field and explains that assigned team discounts take priority', () => {
    expect(panel()).toContain('id="billing-promo-code"');
    expect(panel()).toContain('discounts do not stack');
    expect(panel({ hasPolarSubscription: true })).toContain('from the next billing cycle');
    const assigned = panel({ hasActiveTeamDiscount: true });
    expect(assigned).toContain('Your assigned team discount takes priority');
    expect(/<input[^>]*id="billing-promo-code"[^>]*>/u.exec(assigned)?.[0]).toContain('disabled');
    expect(panel({ canManage: false })).not.toContain('id="billing-promo-code"');
  });

  it('offers a plan change without collection essays', () => {
    const html = panel();
    expect(html).toContain('Change plan');
    expect(html).toContain('Pay as you go');
    expect(html).toContain('Next invoice');
    expect(html).toContain('href="/pricing"');
    expect(html).not.toContain('€0 Polar subscription');
    expect(html).not.toContain('Shadow billing');
    expect(html).not.toContain('Billing state');
    expect(html).not.toContain('Top up');
    expect(html).not.toContain('Auto-reload');
    expect(html).not.toContain('Wallet');
  });

  it('keeps checkout available for the current plan until a Polar subscription exists', () => {
    const open = panel({ planId: 'payg', planName: 'Pay as you go', hasPolarSubscription: false });
    expect(planButton(open, 'Pay as you go')).not.toContain('disabled=""');
    const subscribed = panel({
      planId: 'payg',
      planName: 'Pay as you go',
      hasPolarSubscription: true,
    });
    expect(planButton(subscribed, 'Pay as you go')).toContain('disabled=""');
    expect(planButton(subscribed, 'Team · €49/mo')).not.toContain('disabled=""');
    expect(subscribed).toContain('Manage payment');
  });

  it('turns checkout off on a comp', () => {
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
    expect(html).toContain('Comped');
    expect(html).toContain('No charge');
    expect(invoiceBlock(html)).toContain('€0');
    expect(invoiceBlock(html)).not.toContain('€49');
    expect(html).not.toContain('would save');
    expect(html).not.toContain('>Pay as you go<');
    expect(html).not.toContain('Change plan');
    expect(html).not.toContain('Assign comp');

    const enterprise = panel({
      planId: 'enterprise',
      planName: 'Enterprise',
      billingState: 'enterprise_active',
      platformFeeCents: 250_000,
      meteredSpendCents: 1_200,
      comp: {
        planName: 'Enterprise',
        expired: false,
        reason: 'internal',
        expiresOn: null,
      },
    });
    expect(enterprise).toContain('No charge');
    expect(invoiceBlock(enterprise)).toContain('€0');
    expect(invoiceBlock(enterprise)).not.toContain('€2,512');
  });

  it('shows a pending Enterprise subscription and the negotiated price', () => {
    const html = panel({
      planId: 'enterprise',
      planName: 'Enterprise',
      billingState: 'enterprise_active',
      hasPolarSubscription: false,
      platformFeeCents: 250_000,
      meteredSpendCents: 0,
    });
    expect(html).toContain('data-enterprise-subscription="pending"');
    expect(html).toContain('Subscription pending');
    expect(html).toContain('€2,500');
    expect(html).toContain('Next invoice');
    expect(html).not.toContain('>Pay as you go<');
    expect(html).not.toContain('Negotiated platform fee');
    expect(html).not.toContain('enterprise_active');
  });

  it('shows the past_due banner and a payment-method update', () => {
    const html = panel({
      planId: 'payg',
      planName: 'Pay as you go',
      billingState: 'past_due',
      costBearingPaused: true,
    });
    expect(html).toContain('Payment failed.');
    expect(html).toContain('Update payment method');
    expect(html).not.toContain('bg-signal');
    expect(html).not.toContain('Top up');
    expect(html).not.toContain('Auto-reload');
  });

  it('shows one spend-cap banner when the cap is reached', () => {
    const html = panel({
      planId: 'payg',
      planName: 'Pay as you go',
      billingState: 'payg_active',
      spendCapCents: 2500,
      meteredSpendCents: 2500,
      utilization: {
        spendCapCents: 2500,
        meteredSpendCents: 2500,
        percent: 100,
        warnLevel: 100,
      },
    });
    expect(html).toContain('Spend cap reached.');
    expect(html).toContain('Raise cap');
    expect(html).toContain('€25 of');
    expect(html).toContain('€25');
  });
});
