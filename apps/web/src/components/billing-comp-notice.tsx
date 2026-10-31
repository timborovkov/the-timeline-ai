import { BillingStateBanner } from '@/components/billing-state-banner';

export function BillingCompNotice(props: {
  planName: string;
  expired: boolean;
  reason: string | null;
  expiresOn: string | null;
}) {
  const title = props.expired
    ? 'Comp ended. This workspace is on Free.'
    : `Comped${props.expiresOn ? ` through ${props.expiresOn}` : ''}. No charge.`;
  return <BillingStateBanner title={title} />;
}
