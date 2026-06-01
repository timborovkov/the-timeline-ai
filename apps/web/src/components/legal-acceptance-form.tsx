'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { acceptLegalAction, type AcceptLegalState } from '@/app/actions/legal';
import { Button } from '@/components/ui/button';
import { LEGAL_EFFECTIVE_DATE, PRIVACY_VERSION, TERMS_VERSION } from '@/lib/legal-versions';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full sm:w-auto">
      {pending ? 'Saving...' : 'Accept and continue'}
    </Button>
  );
}

export function LegalAcceptanceForm({ returnTo }: { returnTo?: string }) {
  const [state, action] = useActionState<AcceptLegalState, FormData>(acceptLegalAction, {});
  return (
    <form action={action} className="space-y-5">
      {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
      <div className="rounded-sm border border-border bg-surface p-4 text-sm text-fg-muted">
        <p>
          Current versions: Terms of Use {TERMS_VERSION}, Privacy Policy {PRIVACY_VERSION}.
          Effective {LEGAL_EFFECTIVE_DATE}.
        </p>
      </div>
      <label className="flex items-start gap-3 text-sm leading-6 text-fg">
        <input
          type="checkbox"
          name="accepted"
          required
          className="mt-1 size-4 rounded-sm border-border"
        />
        <span>
          I agree to the{' '}
          <Link href="/terms" className="text-primary hover:underline">
            Terms of Use
          </Link>{' '}
          and acknowledge the{' '}
          <Link href="/privacy" className="text-primary hover:underline">
            Privacy Policy
          </Link>
          .
        </span>
      </label>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      <SubmitButton />
    </form>
  );
}
