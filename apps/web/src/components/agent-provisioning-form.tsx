'use client';
import { useActionState } from 'react';

import { createAgentProvisioningAction } from '@/app/actions/agent-provisioning';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function AgentProvisioningForm() {
  const [state, action, pending] = useActionState(createAgentProvisioningAction, {});
  return (
    <form action={action} className="space-y-4 rounded-md border p-4">
      <label className="block">
        Grant name
        <Input name="name" required maxLength={80} />
      </label>
      <label className="block">
        Maximum new workspaces
        <Input name="allowance" type="number" min={1} max={10} defaultValue={1} required />
      </label>
      <label className="block">
        Expires after days
        <Input name="days" type="number" min={1} max={30} defaultValue={7} required />
      </label>
      <label className="flex gap-2">
        <input name="allowCapture" type="checkbox" />
        Allow the agent to capture notes in newly created workspaces
      </label>
      <p className="text-sm text-muted-foreground">
        Creates new workspaces under your ownership. Does not access existing workspaces or activate
        paid plans. Existing Free eligibility applies.
      </p>
      <Button disabled={pending} type="submit">
        Create provisioning grant
      </Button>
      {state.error ? <p role="alert">{state.error}</p> : null}
      {state.token ? (
        <div role="status">
          <p>
            Save this credential in your agent’s secret store. It is shown only once. Do not paste
            it into chat.
          </p>
          <code className="break-all">{state.token}</code>
        </div>
      ) : null}
    </form>
  );
}
