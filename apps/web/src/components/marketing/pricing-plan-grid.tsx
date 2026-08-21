import { PLAN_CATALOG, SELF_SERVE_PLAN_ORDER, formatEuroFromCents } from '@timeline/shared/billing';

import { cn } from '@/lib/utils';

export function PricingPlanGrid({
  className,
  signedIn = false,
}: {
  className?: string;
  signedIn?: boolean;
}) {
  return (
    <div className={cn('grid gap-px border border-border bg-border lg:grid-cols-4', className)}>
      {SELF_SERVE_PLAN_ORDER.map((planId) => {
        const plan = PLAN_CATALOG[planId];
        const href = signedIn ? '/app/team?section=billing' : plan.cta.href;
        const label = signedIn
          ? planId === 'free'
            ? 'Open billing'
            : 'Manage plan'
          : plan.cta.label;
        return (
          <article
            key={plan.id}
            data-pricing-plan={plan.id}
            className={cn(
              'flex flex-col bg-bg p-5 sm:p-6',
              plan.highlighted && 'ring-1 ring-inset ring-signal',
            )}
          >
            <p className="font-mono text-[0.68rem] tracking-[0.12em] text-fg-muted uppercase">
              {plan.highlighted ? 'Recommended' : plan.name}
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-fg">{plan.name}</h2>
            <p className="mt-2 min-h-[4.5rem] text-sm leading-6 text-fg-muted">{plan.tagline}</p>
            <p className="mt-4 font-mono text-3xl font-semibold tracking-[-0.04em] text-fg">
              {plan.platformFeeCents === 0 ? '€0' : formatEuroFromCents(plan.platformFeeCents ?? 0)}
              {plan.platformFeeCents !== null && plan.platformFeeCents > 0 ? (
                <span className="text-base font-normal text-fg-muted">/mo</span>
              ) : null}
            </p>
            <a
              href={href}
              className={cn(
                'mt-6 inline-flex min-h-11 items-center justify-center rounded-sm px-4 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
                plan.highlighted
                  ? 'bg-signal text-bg hover:opacity-90'
                  : 'border border-border bg-surface text-fg hover:bg-bg',
              )}
            >
              {label}
            </a>
          </article>
        );
      })}
    </div>
  );
}
