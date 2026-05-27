'use client';

import { useActionState, useEffect, useState } from 'react';

import { submitSupportRequestAction, type SupportFormState } from '@/app/actions/support';
import { TurnstileWidget } from '@/components/turnstile-widget';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface SupportFormProps {
  defaultName?: string;
  defaultEmail?: string;
  turnstileSiteKey?: string;
  requiresTurnstile: boolean;
}

const initialState: SupportFormState = {};

export function SupportForm({
  defaultName,
  defaultEmail,
  turnstileSiteKey,
  requiresTurnstile,
}: SupportFormProps) {
  const [state, action, pending] = useActionState(submitSupportRequestAction, initialState);
  const [currentPage, setCurrentPage] = useState('');

  useEffect(() => {
    setCurrentPage(window.location.href);
  }, []);

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="currentPage" value={currentPage} />
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
        <TurnstileWidget siteKey={turnstileSiteKey} />
      ) : requiresTurnstile ? (
        <p className="text-sm text-danger">Support form protection is not configured.</p>
      ) : null}

      {state.error ? <p className="text-sm text-danger">{state.error}</p> : null}
      {state.ok ? (
        <p className="rounded-sm border border-signal/30 bg-signal-soft px-3 py-2 text-sm text-fg">
          We received your request.
        </p>
      ) : null}

      <Button type="submit" disabled={pending || (requiresTurnstile && !turnstileSiteKey)}>
        {pending ? 'Sending...' : 'Send request'}
      </Button>
    </form>
  );
}
