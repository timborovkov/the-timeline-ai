'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import {
  generateGroupLinkTokenAction,
  generatePersonalLinkTokenAction,
  type GenerateLinkTokenState,
} from '@/app/actions/telegram';
import { CopyButton } from '@/components/copy-button';
import { FormActionToast } from '@/components/form-action-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? 'Working…' : label}
    </Button>
  );
}

function TokenResult({
  state,
  botUsername,
}: {
  state: GenerateLinkTokenState;
  botUsername: string | null;
}) {
  if (state.error || !state.token) return null;
  const deepLinkParam = state.scope === 'group' ? 'startgroup' : 'start';
  const deepLink = botUsername
    ? `https://t.me/${botUsername}?${deepLinkParam}=${state.token}`
    : null;
  return (
    <div className="space-y-2 rounded-sm border border-border bg-surface p-3 text-xs">
      <p className="font-medium">Single-use token, expires in 15 minutes.</p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 break-all font-mono">/link {state.token}</code>
        <CopyButton value={`/link ${state.token}`} label="Copy link command" />
      </div>
      {deepLink ? (
        <a
          href={deepLink}
          className="inline-flex text-primary underline underline-offset-4"
          target="_blank"
          rel="noreferrer"
        >
          Open Telegram link
        </a>
      ) : (
        <p className="text-muted-foreground">
          Set <code>TELEGRAM_BOT_USERNAME</code> to enable deep-link buttons.
        </p>
      )}
    </div>
  );
}

function TgUsernameField({ id, error }: { id: string; error?: string }) {
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  return (
    <div className="space-y-2">
      <Label htmlFor={id} size="sm">
        Your Telegram @username
      </Label>
      <Input
        id={id}
        name="tgUsername"
        type="text"
        placeholder="e.g. alice_smith"
        autoComplete="off"
        required
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${helpId} ${errorId}` : helpId}
      />
      <p id={helpId} className="text-xs text-muted-foreground">
        Only an account with this exact @username can consume the token. Set yours in Telegram under
        Settings → Username if you haven&rsquo;t.
      </p>
      {error ? (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function GeneratePersonalTokenForm({ botUsername }: { botUsername: string | null }) {
  const [state, action] = useActionState<GenerateLinkTokenState, FormData>(
    generatePersonalLinkTokenAction,
    {},
  );
  const usernameId = 'personal-tg-username';
  return (
    <form action={action} className="space-y-3">
      <FormActionToast
        id="telegram:personal-link"
        error={state.error}
        success={state.token ? 'Link token created' : undefined}
        loading="Creating link token…"
        fieldError={Boolean(state.fieldError)}
      />
      <p className="sr-only" role="status">
        {state.token ? 'Link token created. It expires in 15 minutes.' : ''}
      </p>
      <TgUsernameField id={usernameId} error={state.fieldError} />
      <Submit label="Generate personal link" />
      <TokenResult state={state} botUsername={botUsername} />
    </form>
  );
}

export function GenerateGroupTokenForm({ botUsername }: { botUsername: string | null }) {
  const [state, action] = useActionState<GenerateLinkTokenState, FormData>(
    generateGroupLinkTokenAction,
    {},
  );
  const usernameId = 'group-tg-username';
  return (
    <form action={action} className="space-y-3">
      <FormActionToast
        id="telegram:group-link"
        error={state.error}
        success={state.token ? 'Link token created' : undefined}
        loading="Creating link token…"
        fieldError={Boolean(state.fieldError)}
      />
      <p className="sr-only" role="status">
        {state.token ? 'Link token created. It expires in 15 minutes.' : ''}
      </p>
      <TgUsernameField id={usernameId} error={state.fieldError} />
      <Submit label="Generate group link" />
      <TokenResult state={state} botUsername={botUsername} />
    </form>
  );
}
