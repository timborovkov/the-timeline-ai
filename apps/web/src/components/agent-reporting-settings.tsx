'use client';

import { useActionState, useId, useState } from 'react';

import type { AgentReportingPreference } from '@timeline/db';

import { updateAgentReportingAction } from '@/app/actions/agent-reporting';
import { ConnectAgentDisclosure } from '@/components/connect-agent/connect-agent-disclosure';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { notifyAction } from '@/lib/notify';

interface Connection {
  id: string;
  name: string;
  description?: string;
  type: 'oauth' | 'api_key';
  preference: AgentReportingPreference | null;
}

function ReportingForm({
  teamId,
  type,
  id,
  preference,
}: {
  teamId: string;
  type: 'workspace' | 'oauth' | 'api_key';
  id?: string;
  preference: AgentReportingPreference | null;
}) {
  const fieldId = useId();
  const [mode, setMode] = useState(
    preference?.mode ?? (type === 'workspace' ? 'on_request' : 'inherit'),
  );
  const [scope, setScope] = useState(preference?.scope ?? '');
  const [state, action, pending] = useActionState(
    async (_previous: { error?: string }, data: FormData) =>
      notifyAction({
        id: `agent-reporting:${id ?? teamId}`,
        loading: 'Saving reporting preference…',
        success: 'Reporting preference saved',
        error: 'Could not save reporting preference. Try again.',
        run: () => updateAgentReportingAction({}, data),
      }),
    {},
  );
  return (
    <form
      action={action}
      className="max-w-xl space-y-4"
      onReset={(event) => {
        // Keep the controlled agreement visible after a successful form action.
        event.preventDefault();
      }}
    >
      <input type="hidden" name="teamId" value={teamId} />
      <input type="hidden" name="type" value={type} />
      {id ? <input type="hidden" name="id" value={id} /> : null}
      <div className="space-y-2">
        <Label htmlFor={`${fieldId}-mode`}>When to report</Label>
        <NativeSelect
          id={`${fieldId}-mode`}
          name="mode"
          value={mode}
          onChange={(event) => {
            setMode(event.target.value);
          }}
          disabled={pending}
          aria-describedby={`${fieldId}-help`}
        >
          {type !== 'workspace' ? <option value="inherit">Use workspace default</option> : null}
          <option value="on_request">Only when asked</option>
          <option value="handoffs">Meaningful work and handoffs</option>
        </NativeSelect>
        <p id={`${fieldId}-help`} className="text-xs leading-5 text-fg-muted">
          {mode === 'inherit'
            ? 'Follows the workspace preference, including future changes.'
            : mode === 'on_request'
              ? 'Your agent reports work only when you ask it to.'
              : 'Ask your agent to report meaningful progress within a specific scope.'}
        </p>
      </div>
      {mode === 'handoffs' ? (
        <div className="space-y-2">
          <Label htmlFor={`${fieldId}-scope`}>Project or work scope</Label>
          <Input
            id={`${fieldId}-scope`}
            name="scope"
            value={scope}
            onChange={(event) => {
              setScope(event.target.value);
            }}
            placeholder="e.g. Website launch — implementation and handoffs"
            maxLength={1000}
            required
            disabled={pending}
            aria-describedby={`${fieldId}-scope-help`}
          />
          <p id={`${fieldId}-scope-help`} className="text-xs leading-5 text-fg-muted">
            Required. Tell the agent which work to report on.
          </p>
        </div>
      ) : (
        <input type="hidden" name="scope" value="" />
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          type="submit"
          disabled={pending || (mode === 'handoffs' && !scope.trim())}
        >
          {pending ? 'Saving…' : 'Save preference'}
        </Button>
        {state.error ? (
          <p role="alert" className="text-sm text-danger">
            {state.error}
          </p>
        ) : null}
      </div>
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
    <div className="space-y-6">
      <p className="max-w-2xl text-sm leading-6 text-fg-muted">
        Choose when agents report work. New connections use the workspace default. Agents still need
        capture permission to save notes.
      </p>
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="space-y-1">
          <h3 className="text-sm font-medium text-fg">Workspace default</h3>
          <p className="text-xs leading-5 text-fg-muted">
            Applies unless a connection overrides it.
          </p>
        </div>
        <ReportingForm teamId={teamId} type="workspace" preference={defaults} />
      </div>
      {connections.length > 0 ? (
        <section aria-label="Connection overrides" className="space-y-2">
          <h3 className="text-sm font-medium text-fg">Connection overrides</h3>
          <div className="divide-y divide-border">
            {connections.map((connection) => (
              <ConnectAgentDisclosure
                key={connection.id}
                title={
                  <span className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <span className="min-w-0 break-words">
                      {connection.name}
                      {connection.description ? (
                        <span className="ml-2 text-xs font-normal text-fg-muted">
                          {connection.description}
                        </span>
                      ) : null}
                    </span>
                    <span className="text-xs font-normal text-fg-muted">
                      {!connection.preference
                        ? 'Workspace default'
                        : connection.preference.mode === 'on_request'
                          ? 'Only when asked'
                          : 'Meaningful work and handoffs'}
                    </span>
                  </span>
                }
              >
                <ReportingForm teamId={teamId} {...connection} />
              </ConnectAgentDisclosure>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
