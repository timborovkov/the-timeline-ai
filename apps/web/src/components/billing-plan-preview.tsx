import { formatEuroFromCents } from '@timeline/shared/billing/catalog';
import {
  shouldShowPlanRecommendation,
  type CheapestPlanPreview,
} from '@timeline/shared/billing/preview';

const PLAN_LABEL: Record<CheapestPlanPreview['recommended'], string> = {
  payg: 'Pay as you go',
  team: 'Team',
  business: 'Business',
};

/** One line when another self-serve plan would meaningfully cost less. */
export function BillingPlanPreview({
  preview,
  currentPlanId,
}: {
  preview: CheapestPlanPreview;
  currentPlanId: string;
}) {
  if (currentPlanId !== 'payg' && currentPlanId !== 'team' && currentPlanId !== 'business') {
    return null;
  }
  if (!shouldShowPlanRecommendation(preview, currentPlanId)) return null;

  const savingCents =
    preview.bills[currentPlanId].totalCents - preview.bills[preview.recommended].totalCents;
  const recommended = PLAN_LABEL[preview.recommended];

  return (
    <p className="text-sm text-fg-muted" data-billing-plan-hint>
      Plan comparison: {recommended} would save {formatEuroFromCents(savingCents)} this month.
    </p>
  );
}
