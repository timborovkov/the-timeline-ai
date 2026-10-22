export function BillingCompNotice(props: {
  planName: string;
  expired: boolean;
  reason: string | null;
  expiresOn: string | null;
}) {
  return (
    <p className="border border-border bg-surface px-3 py-2 text-sm text-fg">
      {props.expired
        ? 'Comped internal plan expired. Entitlements fell back to Free and Polar charges stay off until an operator renews or clears the comp.'
        : `Comped internal plan (${props.planName}). No Polar charges. Usage is still metered and the spend cap still pauses cost-bearing work.`}
      {props.reason ? ` Reason: ${props.reason}.` : ''}
      {props.expiresOn && !props.expired ? ` Comp runs through ${props.expiresOn} UTC.` : ''}
    </p>
  );
}
