'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import { resendEmailVerificationAction, type EmailVerificationState } from '@/app/actions/auth';
import { BillingStateBanner } from '@/components/billing-state-banner';

export type BillingRestrictionReason =
  'email_unverified' | 'free_grant_elsewhere' | 'contact_owner';

export function BillingRestrictionNotice({ reason }: { reason: BillingRestrictionReason }) {
  const [state, resend, pending] = useActionState<EmailVerificationState, FormData>(
    resendEmailVerificationAction,
    {},
  );
  if (reason === 'contact_owner') {
    return (
      <BillingStateBanner title="Billing setup is incomplete. Ask a team owner to verify their email or choose a plan.">
        <Link href="/app/team?section=members" className="text-sm underline underline-offset-4">
          View team owners
        </Link>
      </BillingStateBanner>
    );
  }
  if (reason === 'free_grant_elsewhere') {
    return (
      <BillingStateBanner title="Your Free allowance is assigned to another team. Choose Pay as you go or another plan to enable metered work here.">
        <Link
          href="/app/team?section=billing#change-plan"
          className="text-sm underline underline-offset-4"
        >
          Choose a plan
        </Link>
      </BillingStateBanner>
    );
  }
  return (
    <div className="space-y-2">
      <BillingStateBanner title="Verify your email to check eligibility for Free access on this team.">
        <form action={resend}>
          <button
            type="submit"
            disabled={pending}
            className="text-sm underline underline-offset-4 disabled:opacity-50"
          >
            {pending ? 'Sending…' : 'Send verification email'}
          </button>
        </form>
      </BillingStateBanner>
      {state.ok ? (
        <p role="status" className="text-sm text-fg-muted">
          Verification email sent. Follow the link to continue setup.
        </p>
      ) : null}
      {state.error ? (
        <p role="alert" className="text-sm text-fg-muted">
          {state.error}
        </p>
      ) : null}
    </div>
  );
}
