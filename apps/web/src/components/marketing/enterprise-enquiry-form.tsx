'use client';

import { useActionState, useEffect, useRef, useState } from 'react';

import {
  submitEnterpriseEnquiryAction,
  type EnterpriseEnquiryState,
} from '@/app/actions/enterprise';
import { FormActionToast } from '@/components/form-action-toast';
import { useSupportEmail } from '@/components/support-email-provider';
import { TurnstileWidget } from '@/components/turnstile-widget';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  ENTERPRISE_RESPONSE_EXPECTATION,
  ENTERPRISE_TEAM_SIZES,
  ENTERPRISE_TOPICS,
  formatEnterprisePricingContext,
  type EnterpriseEnquiryPrefill,
  type EnterpriseTopic,
} from '@/lib/enterprise-enquiry';
import { usePublicRuntime, type PublicRuntime } from '@/lib/public-runtime';

interface EnterpriseEnquiryFormProps {
  prefill?: EnterpriseEnquiryPrefill;
  defaultTopics?: readonly EnterpriseTopic[];
  turnstileSiteKey?: string;
  requiresTurnstile?: boolean;
}

const initialState: EnterpriseEnquiryState = {};
const protectionErrorId = 'enterprise-form-protection-error';

function nonEmptyTrimmed(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
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

function useEnterpriseFormProtection({
  turnstileSiteKey,
  requiresTurnstile,
}: Pick<EnterpriseEnquiryFormProps, 'turnstileSiteKey' | 'requiresTurnstile'>) {
  const runtime = usePublicRuntime(turnstileSiteKey === undefined && requiresTurnstile !== false);
  const required = resolveRequiresTurnstile(requiresTurnstile, runtime);
  const turnstile = resolveTurnstileSiteKey(turnstileSiteKey, {
    status: runtime.status,
    siteKey: runtimeTurnstileSiteKey(runtime),
  });
  return protectionFlags(required, turnstile);
}

function EnquiryReceived({
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
        <p className="font-semibold text-fg">Enquiry received</p>
        <p className="text-fg-muted">{ENTERPRISE_RESPONSE_EXPECTATION}</p>
        <p className="text-fg-muted">Keep this reference if you need to follow up:</p>
      </div>
      <p>
        <code className="select-text break-all font-mono text-xs text-fg">{requestReference}</code>
      </p>
      {warning ? <p className="text-fg-muted">{warning}</p> : null}
    </div>
  );
}

function FormProtection({
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
      Form protection is unavailable. Email{' '}
      <a className="underline underline-offset-4" href={`mailto:${supportEmail}`}>
        {supportEmail}
      </a>{' '}
      instead.
    </p>
  );
}

function EnterpriseEnquiryFields({
  action,
  pending,
  state,
  protection,
  supportEmail,
  prefill,
  defaultTopics,
  onSubmitIntent,
}: {
  action: (payload: FormData) => void;
  onSubmitIntent: (pointer: boolean) => void;
  pending: boolean;
  state: EnterpriseEnquiryState;
  protection: { siteKey?: string; unavailable: boolean; pending: boolean };
  supportEmail: string;
  prefill: EnterpriseEnquiryPrefill;
  defaultTopics: readonly EnterpriseTopic[];
}) {
  const pricingContext = formatEnterprisePricingContext(prefill);

  return (
    <form action={action} className="space-y-5">
      <FormActionToast
        id="enterprise:enquiry"
        error={state.error}
        success={state.ok ? 'We received your enquiry' : undefined}
        loading="Sending enquiry…"
      />
      {pricingContext ? (
        <input type="hidden" name="pricingContext" value={pricingContext} readOnly />
      ) : null}
      <div className="hidden" aria-hidden="true">
        <Label htmlFor="enterprise-company">Company website</Label>
        <Input
          id="enterprise-company"
          name="company"
          tabIndex={-1}
          autoComplete="off"
          className="hidden"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="enterprise-name">Name</Label>
          <Input
            className="text-base sm:text-sm"
            id="enterprise-name"
            name="name"
            autoComplete="name"
            required
            maxLength={120}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="enterprise-email">Work email</Label>
          <Input
            className="text-base sm:text-sm"
            id="enterprise-email"
            name="email"
            type="email"
            autoComplete="email"
            spellCheck={false}
            required
            maxLength={240}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="enterprise-organization">Company</Label>
          <Input
            className="text-base sm:text-sm"
            id="enterprise-organization"
            name="organization"
            autoComplete="organization"
            required
            maxLength={200}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="enterprise-team-size">Team size</Label>
          <select
            id="enterprise-team-size"
            name="teamSize"
            required
            className="h-10 w-full rounded-sm border border-input bg-background px-3 text-base sm:text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            defaultValue=""
          >
            <option value="" disabled>
              Select team size
            </option>
            {ENTERPRISE_TEAM_SIZES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-fg">What do you need?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {ENTERPRISE_TOPICS.map((topic) => (
            <label
              key={topic.value}
              className="flex min-h-10 items-center gap-2 rounded-sm text-sm text-fg"
            >
              <input
                type="checkbox"
                name="topics"
                value={topic.value}
                defaultChecked={defaultTopics.includes(topic.value)}
                className="size-4 rounded-sm border border-input accent-signal"
              />
              {topic.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="space-y-2">
        <Label htmlFor="enterprise-message">Message</Label>
        <Textarea
          className="text-base sm:text-sm"
          id="enterprise-message"
          name="message"
          required
          minLength={20}
          maxLength={5000}
          rows={7}
          placeholder="Share procurement timelines, security review needs, or any constraints we should know."
        />
      </div>

      {pricingContext ? (
        <p className="text-xs leading-5 text-fg-muted">
          Included from pricing: <span className="font-mono text-fg">{pricingContext}</span>
        </p>
      ) : null}

      <FormProtection
        siteKey={protection.siteKey}
        unavailable={protection.unavailable}
        supportEmail={supportEmail}
      />

      <p className="text-xs leading-5 text-fg-muted">
        {ENTERPRISE_RESPONSE_EXPECTATION} We store your contact details and message for sales
        handling and email the Timeline team. If you are signed in, we also attach your account ID
        and active team ID and role. Workspace content is never attached automatically. Your IP
        address may be used briefly for abuse prevention but is not saved with the enquiry.
      </p>

      <Button
        type="submit"
        onClick={(event) => {
          onSubmitIntent(event.detail > 0);
        }}
        disabled={pending || protection.pending || protection.unavailable}
        aria-describedby={protection.unavailable ? protectionErrorId : undefined}
      >
        {pending ? 'Sending…' : 'Send enterprise enquiry'}
      </Button>
    </form>
  );
}

export function EnterpriseEnquiryForm({
  prefill = {},
  defaultTopics = [],
  turnstileSiteKey,
  requiresTurnstile,
}: EnterpriseEnquiryFormProps) {
  const supportEmail = useSupportEmail();
  const [pointerSubmission, setPointerSubmission] = useState(false);
  const [state, action, pending] = useActionState(submitEnterpriseEnquiryAction, initialState);
  const protection = useEnterpriseFormProtection({ turnstileSiteKey, requiresTurnstile });

  if (state.ok && state.requestReference) {
    return (
      <EnquiryReceived
        requestReference={state.requestReference}
        warning={state.warning}
        animate={pointerSubmission}
      />
    );
  }

  return (
    <EnterpriseEnquiryFields
      action={action}
      onSubmitIntent={setPointerSubmission}
      pending={pending}
      state={state}
      protection={protection}
      supportEmail={supportEmail}
      prefill={prefill}
      defaultTopics={defaultTopics}
    />
  );
}
