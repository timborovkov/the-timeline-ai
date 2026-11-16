'use client';

import { useActionState, useEffect, useRef, useState } from 'react';

import type { SupportSurface } from '@/lib/support-context';

import { submitSupportRequestAction, type SupportFormState } from '@/app/actions/support';
import { FormActionToast } from '@/components/form-action-toast';
import { useSupportEmail } from '@/components/support-email-provider';
import { TurnstileWidget } from '@/components/turnstile-widget';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { usePublicRuntime, type PublicRuntime } from '@/lib/public-runtime';

interface SupportFormProps {
  defaultName?: string;
  defaultEmail?: string;
  defaultSurface?: SupportSurface;
  defaultErrorReference?: string;
  turnstileSiteKey?: string;
  requiresTurnstile?: boolean;
}

const initialState: SupportFormState = {};
const protectionErrorId = 'support-form-protection-error';

function nonEmptyTrimmed(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function fillEmptyInput(input: HTMLInputElement | null, nextValue?: string) {
  if (!nextValue) return;
  if (!input) return;
  if (input.value !== '') return;
  input.value = nextValue;
}

function useFillEmptyDefault(nextValue?: string) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    fillEmptyInput(ref.current, nextValue);
  }, [nextValue]);
  return ref;
}

function resolveTurnstileSiteKey(
  turnstileSiteKey: string | undefined,
  runtime: { status: 'unknown' | 'ready'; siteKey?: string },
): { siteKey?: string; ready: boolean } {
  if (turnstileSiteKey !== undefined) {
    return { siteKey: nonEmptyTrimmed(turnstileSiteKey), ready: true };
  }
  if (runtime.status !== 'ready') return { ready: false };
  return { siteKey: runtime.siteKey, ready: true };
}

function resolveRequiresTurnstile(
  requiresTurnstile: boolean | undefined,
  runtime: PublicRuntime,
): boolean {
  if (requiresTurnstile === false) return false;
  if (requiresTurnstile === true) return true;
  if (runtime.status !== 'ready') return true;
  return runtime.requiresTurnstile;
}

function runtimeTurnstileSiteKey(runtime: PublicRuntime): string | undefined {
  if (runtime.status !== 'ready') return undefined;
  return runtime.turnstileSiteKey;
}

function protectionFlags(
  required: boolean,
  turnstile: { siteKey?: string; ready: boolean },
): { siteKey?: string; unavailable: boolean; pending: boolean } {
  return {
    siteKey: turnstile.siteKey,
    unavailable: required && turnstile.ready && !turnstile.siteKey,
    pending: required && !turnstile.ready,
  };
}

function useSupportFormProtection({
  turnstileSiteKey,
  requiresTurnstile,
}: Pick<SupportFormProps, 'turnstileSiteKey' | 'requiresTurnstile'>) {
  const runtime = usePublicRuntime(turnstileSiteKey === undefined && requiresTurnstile !== false);
  const required = resolveRequiresTurnstile(requiresTurnstile, runtime);
  const turnstile = resolveTurnstileSiteKey(turnstileSiteKey, {
    status: runtime.status,
    siteKey: runtimeTurnstileSiteKey(runtime),
  });
  return protectionFlags(required, turnstile);
}

function SupportRequestReceived({
  requestReference,
  warning,
  animate,
}: {
  requestReference: string;
  warning?: string;
  animate: boolean;
}) {
  const confirmation = useRef<HTMLDivElement>(null);
  const message = useRef<HTMLDivElement>(null);
  useEffect(() => {
    confirmation.current?.focus();
    if (!animate) return;
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (preference.matches) return;
    const animation = message.current?.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 160,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    });
    const stop = () => {
      if (preference.matches) animation?.cancel();
    };
    preference.addEventListener('change', stop);
    return () => {
      animation?.cancel();
      preference.removeEventListener('change', stop);
    };
  }, [animate]);
  return (
    <div
      role="status"
      ref={confirmation}
      tabIndex={-1}
      aria-live="polite"
      aria-atomic="true"
      className="block space-y-3 border-l-2 border-signal pl-4 text-sm"
    >
      <div ref={message} className="space-y-3">
        <p className="font-semibold text-fg">Request received</p>
        <p className="text-fg-muted">Keep this reference if you need to follow up:</p>
      </div>
      <p>
        <code className="select-text break-all font-mono text-xs text-fg">{requestReference}</code>
      </p>
      {warning ? <p className="text-fg-muted">{warning}</p> : null}
    </div>
  );
}

function SupportFormProtection({
  siteKey,
  unavailable,
  supportEmail,
}: {
  siteKey?: string;
  unavailable: boolean;
  supportEmail: string;
}) {
  if (siteKey) return <TurnstileWidget action="support" siteKey={siteKey} />;
  if (!unavailable) return null;
  return (
    <p id={protectionErrorId} className="text-sm text-danger">
      Support form protection is unavailable. Email{' '}
      <a className="underline underline-offset-4" href={`mailto:${supportEmail}`}>
        {supportEmail}
      </a>{' '}
      instead.
    </p>
  );
}

function SupportFormFields({
  action,
  pending,
  state,
  protection,
  supportEmail,
  defaultName,
  defaultEmail,
  defaultSurface,
  defaultErrorReference,
  onSubmitIntent,
}: {
  action: (payload: FormData) => void;
  onSubmitIntent: (pointer: boolean) => void;
  pending: boolean;
  state: SupportFormState;
  protection: { siteKey?: string; unavailable: boolean; pending: boolean };
  supportEmail: string;
  defaultName?: string;
  defaultEmail?: string;
  defaultSurface?: SupportSurface;
  defaultErrorReference?: string;
}) {
  const nameRef = useFillEmptyDefault(defaultName);
  const emailRef = useFillEmptyDefault(defaultEmail);

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
            className="text-base sm:text-sm"
            ref={nameRef}
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
            className="text-base sm:text-sm"
            ref={emailRef}
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
          className="h-10 w-full rounded-sm border border-input bg-background px-3 text-base sm:text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
          className="text-base sm:text-sm"
          id="support-message"
          name="message"
          required
          minLength={20}
          maxLength={5000}
          rows={8}
        />
      </div>

      <SupportFormProtection
        siteKey={protection.siteKey}
        unavailable={protection.unavailable}
        supportEmail={supportEmail}
      />

      <p className="text-xs leading-5 text-fg-muted">
        When you submit, we store your contact details and message. If you are signed in, we also
        attach your account ID and active team ID and role. The page category, error reference,
        deployed release, and browser information are included when available. Workspace content is
        never attached automatically. Your IP address may be used briefly for abuse prevention but
        is not saved with the request.
      </p>

      <Button
        type="submit"
        onClick={(event) => {
          onSubmitIntent(event.detail > 0);
        }}
        disabled={pending || protection.pending || protection.unavailable}
        aria-describedby={protection.unavailable ? protectionErrorId : undefined}
      >
        {pending ? 'Sending…' : 'Send request'}
      </Button>
    </form>
  );
}

export function SupportForm({
  defaultName,
  defaultEmail,
  defaultSurface,
  defaultErrorReference,
  turnstileSiteKey,
  requiresTurnstile,
}: SupportFormProps) {
  const supportEmail = useSupportEmail();
  const [pointerSubmission, setPointerSubmission] = useState(false);
  const [state, action, pending] = useActionState(submitSupportRequestAction, initialState);
  const protection = useSupportFormProtection({ turnstileSiteKey, requiresTurnstile });

  if (state.ok && state.requestReference) {
    return (
      <SupportRequestReceived
        requestReference={state.requestReference}
        warning={state.warning}
        animate={pointerSubmission}
      />
    );
  }

  return (
    <SupportFormFields
      action={action}
      onSubmitIntent={setPointerSubmission}
      pending={pending}
      state={state}
      protection={protection}
      supportEmail={supportEmail}
      defaultName={defaultName}
      defaultEmail={defaultEmail}
      defaultSurface={defaultSurface}
      defaultErrorReference={defaultErrorReference}
    />
  );
}
