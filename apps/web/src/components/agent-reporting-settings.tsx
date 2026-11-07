'use client';
import { useActionState } from 'react';

import type { AgentReportingPreference } from '@timeline/db';

import { updateAgentReportingAction } from '@/app/actions/agent-reporting';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Connection {
  id: string;
  name: string;
  type: 'oauth' | 'api_key';
  preference: AgentReportingPreference | null;
}
function ReportingForm({
  teamId,
  type,
  id,
  name,
  preference,
}: {
  teamId: string;
  type: 'workspace' | 'oauth' | 'api_key';
  id?: string;
  name: string;
  preference: AgentReportingPreference | null;
}) {
  const [state, action, pending] = useActionState(updateAgentReportingAction, {});
  return (
    <form action={action} className="space-y-3 rounded-md border p-4">
      <h3 className="font-medium">{name}</h3>
      <input type="hidden" name="teamId" value={teamId} />
      <input type="hidden" name="type" value={type} />
      {id ? <input type="hidden" name="id" value={id} /> : null}
      <label className="block">
        Reporting mode{' '}
        <select
          name="mode"
          defaultValue={preference?.mode ?? 'inherit'}
          className="rounded border bg-background p-2"
        >
          {type !== 'workspace' ? <option value="inherit">Use workspace default</option> : null}
          <option value="on_request">On request</option>
          <option value="handoffs">Meaningful work and handoffs</option>
        </select>
      </label>
      <label className="block">
        Project or work scope (required for ongoing reporting)
        <Input name="scope" defaultValue={preference?.scope ?? ''} maxLength={1000} />
      </label>
      <Button variant="outline" type="submit" disabled={pending}>
        Save reporting preference
      </Button>
      {state.error ? <p role="alert">{state.error}</p> : null}
      {state.saved ? <p role="status">Reporting preference saved.</p> : null}
    </form>
  );
}
export function AgentReportingSettings({
  teamId,
  defaults,
  connections,
}: {
  teamId: string;
  defaults: AgentReportingPreference;
  connections: Connection[];
}) {
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-medium">Coworker reporting</h2>
      <p className="text-sm text-muted-foreground">
        Tell connected agents when to report work. These preferences guide their behavior; agents
        still need capture permission to save notes. New connections inherit the workspace default.
      </p>
      <ReportingForm
        teamId={teamId}
        type="workspace"
        name="Workspace default"
        preference={defaults}
      />
      {connections.map((connection) => (
        <ReportingForm key={connection.id} teamId={teamId} {...connection} />
      ))}
    </section>
  );
}
