import type { SignupPlanCopy } from '@/lib/signup-plan';

export function SignupPlanSummary({ copy }: { copy: SignupPlanCopy }) {
  return (
    <aside
      data-signup-plan={copy.planId}
      aria-label={`${copy.name} plan details`}
      className="rounded-md border border-border bg-bg/70 p-4 text-sm leading-6 text-fg-muted"
    >
      <p className="font-medium text-fg">
        Selected plan: <span data-signup-plan-name>{copy.name}</span>
      </p>
      <p className="mt-2 text-xs font-medium uppercase tracking-wide text-fg-muted">Includes</p>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-fg-muted">
        {copy.includes.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <p className="mt-3">
        <span className="font-medium text-fg">When billing starts: </span>
        {copy.billingStarts}
      </p>
      <p className="mt-2">
        <span className="font-medium text-fg">Review or change: </span>
        {copy.reviewWhere}
      </p>
    </aside>
  );
}
