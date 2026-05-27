'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import {
  generateGroupLinkTokenAction,
  generatePersonalLinkTokenAction,
  type GenerateLinkTokenState,
} from '@/app/actions/telegram';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
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
  if (state.error) return <p className="text-sm text-destructive">{state.error}</p>;
  if (!state.token) return null;
  const deepLinkParam = state.scope === 'group' ? 'startgroup' : 'start';
  const deepLink = botUsername
    ? `https://t.me/${botUsername}?${deepLinkParam}=${state.token}`
    : null;
  return (
    <div className="space-y-2 rounded-md border bg-muted p-3 text-xs">
      <p className="font-medium">Single-use token, expires in 15 minutes.</p>
      <p>
        DM the bot and send: <code className="font-mono">/link {state.token}</code>
      </p>
      {deepLink ? (
        <p>
          Or open this deep link:{' '}
          <a
            href={deepLink}
            className="break-all font-mono text-[12px] underline"
            target="_blank"
            rel="noreferrer"
          >
            {deepLink}
          </a>
        </p>
      ) : (
        <p className="text-muted-foreground">
          Set <code>TELEGRAM_BOT_USERNAME</code> to enable deep-link buttons.
        </p>
      )}
    </div>
  );
}

function TgUsernameField({ id }: { id: string }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Your Telegram @username</Label>
      <Input
        id={id}
        name="tgUsername"
        type="text"
        placeholder="e.g. alice_smith"
        autoComplete="off"
        required
      />
      <p className="text-xs text-muted-foreground">
        Only an account with this exact @username can consume the token. Set yours in Telegram under
        Settings → Username if you haven&rsquo;t.
      </p>
    </div>
  );
}

export function GeneratePersonalTokenForm({ botUsername }: { botUsername: string | null }) {
  const [state, action] = useActionState<GenerateLinkTokenState, FormData>(
    generatePersonalLinkTokenAction,
    {},
  );
  return (
    <form action={action} className="space-y-3">
      <TgUsernameField id="personal-tg-username" />
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
  return (
    <form action={action} className="space-y-3">
      <TgUsernameField id="group-tg-username" />
      <Submit label="Generate group link" />
      <TokenResult state={state} botUsername={botUsername} />
    </form>
  );
}
