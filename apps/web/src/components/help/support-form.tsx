'use client';

import { useActionState } from 'react';

import type { SupportSurface } from '@/lib/support-context';

import { submitSupportRequestAction, type SupportFormState } from '@/app/actions/support';
import { FormActionToast } from '@/components/form-action-toast';
import { TurnstileWidget } from '@/components/turnstile-widget';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { PUBLIC_SUPPORT_EMAIL } from '@/lib/support-links';

interface SupportFormProps {
  defaultName?: string;
  defaultEmail?: string;
  defaultSurface?: SupportSurface;
  defaultErrorReference?: string;
  turnstileSiteKey?: string;
  requiresTurnstile: boolean;
}

const initialState: SupportFormState = {};
const protectionErrorId = 'support-form-protection-error';

export function SupportForm({
  defaultName,
  defaultEmail,
  defaultSurface,
  defaultErrorReference,
  turnstileSiteKey,
  requiresTurnstile,
}: SupportFormProps) {
  const [state, action, pending] = useActionState(submitSupportRequestAction, initialState);
  const protectionUnavailable = requiresTurnstile && !turnstileSiteKey;

  if (state.ok && state.requestReference) {
    return (
      <output className="block space-y-3 border-l-2 border-signal pl-4 text-sm">
        <p className="font-semibold text-fg">Request received</p>
        <p className="text-fg-muted">
          Keep this reference if you need to follow up:{' '}
          <code className="font-mono text-xs text-fg">{state.requestReference}</code>
        </p>
        {state.warning ? <p className="text-fg-muted">{state.warning}</p> : null}
      </output>
    );
  }

  return (
    <form action={action} className="space-y-5">
      <FormActionToast
        id="support:request"
        error={state.error}
        success={state.ok ? 'We received your request' : undefined}
        loading="Sending request…"
      />
      {defaultSurface ? (
        <input type="hidden" name="surface" value={defaultSurface} readOnly />
      ) : null}
      {defaultErrorReference ? (
        <input type="hidden" name="errorReference" value={defaultErrorReference} readOnly />
      ) : null}
      <div className="hidden" aria-hidden="true">
        <Label htmlFor="support-company">Company website</Label>
        <Input
          id="support-company"
          name="company"
          tabIndex={-1}
          autoComplete="off"
          className="hidden"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="support-name">Name</Label>
          <Input
            id="support-name"
            name="name"
            autoComplete="name"
            defaultValue={defaultName}
            required
            maxLength={120}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="support-email">Email</Label>
          <Input
            id="support-email"
            name="email"
            type="email"
            autoComplete="email"
            spellCheck={false}
            defaultValue={defaultEmail}
            required
            maxLength={240}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="support-request-type">Request type</Label>
        <select
          id="support-request-type"
          name="requestType"
          required
          className="h-10 w-full rounded-sm border border-input bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          defaultValue="technical_support"
        >
          <option value="technical_support">Technical support</option>
          <option value="sales">Sales</option>
          <option value="billing">Billing</option>
          <option value="security">Security</option>
          <option value="other">Other</option>
        </select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="support-message">Message</Label>
        <Textarea
          id="support-message"
          name="message"
          required
          minLength={20}
          maxLength={5000}
          rows={8}
        />
      </div>

      {turnstileSiteKey ? (
        <TurnstileWidget action="support" siteKey={turnstileSiteKey} />
      ) : protectionUnavailable ? (
        <p id={protectionErrorId} className="text-sm text-danger">
          Support form protection is unavailable. Email{' '}
          <a className="underline underline-offset-4" href={`mailto:${PUBLIC_SUPPORT_EMAIL}`}>
            {PUBLIC_SUPPORT_EMAIL}
          </a>{' '}
          instead.
        </p>
      ) : null}

      <p className="text-xs leading-5 text-fg-muted">
        When you submit, we store your contact details and message. If you are signed in, we also
        attach your account ID and active team ID and role. The page category, error reference,
        deployed release, and browser information are included when available. Workspace content is
        never attached automatically. Your IP address may be used briefly for abuse prevention but
        is not saved with the request.
      </p>

      <Button
        type="submit"
        disabled={pending || protectionUnavailable}
        aria-describedby={protectionUnavailable ? protectionErrorId : undefined}
      >
        {pending ? 'Sending…' : 'Send request'}
      </Button>
    </form>
  );
}
