'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { submitSupportAction, type SupportState } from '@/app/actions/support';
import { TurnstileWidget } from '@/components/turnstile-widget';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? 'Sending…' : 'Send message'}
    </Button>
  );
}

export function SupportForm({ turnstileSiteKey }: { turnstileSiteKey?: string }) {
  const [state, action] = useActionState<SupportState, FormData>(submitSupportAction, {});
  return (
    <form action={action} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="support-name">Name</Label>
        <Input id="support-name" name="name" autoComplete="name" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="support-email">Email</Label>
        <Input id="support-email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="support-subject">Subject</Label>
        <Input id="support-subject" name="subject" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="support-message">Message</Label>
        <textarea
          id="support-message"
          name="message"
          minLength={10}
          required
          className="min-h-36 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      <TurnstileWidget siteKey={turnstileSiteKey} />
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state.ok ? <p className="text-sm text-emerald-700">Message sent.</p> : null}
      <SubmitButton />
    </form>
  );
}
