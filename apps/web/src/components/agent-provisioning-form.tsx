'use client';
import { useActionState } from 'react';

import { createAgentProvisioningAction } from '@/app/actions/agent-provisioning';
import { CopyButton } from '@/components/copy-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function AgentProvisioningForm() {
  const [state, action, pending] = useActionState(createAgentProvisioningAction, {});
  return (
    <form action={action} className="space-y-5">
      <label className="block space-y-2 text-sm font-medium">
        Grant name
        <Input name="name" placeholder="e.g. Workspace setup agent" required maxLength={80} />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-2 text-sm font-medium">
          Maximum new workspaces
          <Input name="allowance" type="number" min={1} max={10} defaultValue={1} required />
        </label>
        <label className="block space-y-2 text-sm font-medium">
          Expires after (days)
          <Input name="days" type="number" min={1} max={30} defaultValue={7} required />
        </label>
      </div>
      <label className="flex items-start gap-3 rounded-md border bg-muted/30 p-4 text-sm leading-6">
        <input name="allowCapture" type="checkbox" className="mt-1 size-4 shrink-0 accent-signal" />
        <span>
          <span className="block font-medium">Allow note capture</span>
          <span className="text-muted-foreground">
            The agent can capture notes in workspaces it creates.
          </span>
        </span>
      </label>
      <p className="text-sm text-muted-foreground">
        Creates new workspaces under your ownership. Does not access existing workspaces or activate
        paid plans. Existing Free eligibility applies.
      </p>
      <Button disabled={pending} type="submit">
        {pending ? 'Creating grant…' : 'Create grant'}
      </Button>
      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
      {state.token ? (
        <div
          role="status"
          className="space-y-3 rounded-md border border-signal/40 bg-signal/5 p-4 text-sm"
        >
          <p className="font-medium">Save your credential</p>
          <p>
            Save this credential in your agent’s secret store. It is shown only once. Do not paste
            it into chat.
          </p>
          <code className="block break-all rounded-sm bg-muted p-3 text-xs">{state.token}</code>
          <CopyButton value={state.token} label="Copy credential" />
        </div>
      ) : null}
    </form>
  );
}
