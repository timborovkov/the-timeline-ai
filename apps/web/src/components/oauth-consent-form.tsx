'use client';

import { useActionState, useState, type ReactNode } from 'react';

import type { TeamMembership } from '@/lib/active-team';
import type { AgentReportingPreference } from '@timeline/db';

import { approveMcpOAuthAction } from '@/app/oauth/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export type ConsentMembership = TeamMembership & {
  reporting: { defaults: AgentReportingPreference; override: AgentReportingPreference | null };
};
type Mode = 'inherit' | 'on_request' | 'handoffs';
interface Props {
  memberships: ConsentMembership[];
  defaultTeamId: string | null;
  requiresTeamAdmin: boolean;
  children: ReactNode;
}

export function OAuthConsentForm(props: Props) {
  const [teamId, setTeamId] = useState(props.defaultTeamId);
  const [capture, setCapture] = useState(true);
  return (
    <TeamConsentForm
      key={teamId}
      {...props}
      teamId={teamId}
      onTeamChange={setTeamId}
      capture={capture}
      onCaptureChange={setCapture}
    />
  );
}

function TeamConsentForm({
  memberships,
  requiresTeamAdmin,
  children,
  teamId,
  onTeamChange,
  capture,
  onCaptureChange,
}: Props & {
  teamId: string | null;
  onTeamChange: (id: string) => void;
  capture: boolean;
  onCaptureChange: (value: boolean) => void;
}) {
  const membership = memberships.find((item) => item.teamId === teamId);
  const { mode, setMode, scope, setScope, canManage, changed, invalidScope, missingCapture } =
    useReportingDraft(membership, capture);
  const [state, action, pending] = useActionState(
    (_previous: { error?: string }, data: FormData): Promise<{ error?: string }> =>
      approveMcpOAuthAction(data),
    {},
  );
  return (
    <form
      action={action}
      className="space-y-5"
      onReset={(event) => {
        // A returned validation error completes the action but must not reset consent choices.
        event.preventDefault();
      }}
    >
      {children}
      <TeamPicker
        memberships={memberships}
        requiresTeamAdmin={requiresTeamAdmin}
        teamId={teamId}
        onTeamChange={onTeamChange}
      />
      <CaptureCheckbox capture={capture} onCaptureChange={onCaptureChange} />
      {membership ? (
        <ReportingControls
          membership={membership}
          mode={mode}
          scope={scope}
          onModeChange={setMode}
          onScopeChange={setScope}
          capture={capture}
        />
      ) : null}
      {canManage ? (
        <>
          <input type="hidden" name="reporting_mode" value={changed ? mode : 'preserve'} />
          <input
            type="hidden"
            name="reporting_scope"
            value={changed && mode === 'handoffs' ? scope : ''}
          />
        </>
      ) : null}
      {invalidScope ? <p role="alert">Describe the work scope for ongoing reporting.</p> : null}
      {missingCapture ? (
        <p role="alert">
          Enable capture permission to select ongoing reporting, or choose another reporting option.
        </p>
      ) : null}
      {state.error ? <p role="alert">{state.error}</p> : null}
      <Button
        type="submit"
        className="w-full"
        disabled={!membership || pending || invalidScope || missingCapture}
      >
        Allow access
      </Button>
    </form>
  );
}

function useReportingDraft(membership: ConsentMembership | undefined, capture: boolean) {
  const initial = membership?.reporting.override;
  const [mode, setMode] = useState<Mode>(initial?.mode ?? 'inherit');
  const [scope, setScope] = useState(initial?.scope ?? '');
  return {
    mode,
    setMode,
    scope,
    setScope,
    ...reportingDraftState(membership, mode, scope, capture),
  };
}
function reportingDraftState(
  membership: ConsentMembership | undefined,
  mode: Mode,
  scope: string,
  capture: boolean,
) {
  const initial = membership?.reporting.override;
  const canManage = Boolean(membership && membership.role !== 'member');
  const changed =
    mode !== (initial?.mode ?? 'inherit') ||
    (mode === 'handoffs' && scope.trim() !== initial?.scope);
  return {
    canManage,
    changed,
    invalidScope: canManage && changed && mode === 'handoffs' && !scope.trim(),
    missingCapture: canManage && changed && mode === 'handoffs' && !capture,
  };
}

function TeamPicker({
  memberships,
  requiresTeamAdmin,
  teamId,
  onTeamChange,
}: {
  memberships: ConsentMembership[];
  requiresTeamAdmin: boolean;
  teamId: string | null;
  onTeamChange: (id: string) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold text-fg">Choose a team</legend>
      <p className="text-xs leading-5 text-fg-muted">
        The app receives your permissions in this team. It does not receive team-admin access.
      </p>
      {requiresTeamAdmin ? (
        <p className="text-xs text-fg-muted">
          Agent access can be granted only for teams where you are an owner or admin.
        </p>
      ) : null}
      {memberships.map((item) => (
        <label
          key={item.teamId}
          className="flex items-center gap-3 rounded-md border border-border p-3 text-sm"
        >
          <input
            type="radio"
            name="team_id"
            value={item.teamId}
            checked={item.teamId === teamId}
            onChange={() => {
              onTeamChange(item.teamId);
            }}
            required
            disabled={requiresTeamAdmin && item.role === 'member'}
            className="size-4 accent-primary"
          />
          <span className="flex-1 font-medium">{item.teamName}</span>
          <span className="text-xs capitalize text-fg-muted">
            {item.role}
            {requiresTeamAdmin && item.role === 'member' ? ' · unavailable' : ''}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
function CaptureCheckbox({
  capture,
  onCaptureChange,
}: {
  capture: boolean;
  onCaptureChange: (value: boolean) => void;
}) {
  return (
    <label className="flex min-h-11 items-start gap-3 rounded-md border border-border p-3">
      <input
        type="checkbox"
        name="grant_capture"
        value="1"
        checked={capture}
        onChange={(event) => {
          onCaptureChange(event.target.checked);
        }}
        className="mt-0.5 size-4 accent-primary"
      />
      <span>
        <span className="block text-sm font-medium">Capture notes in Timeline</span>
        <span className="block text-xs leading-5 text-fg-muted">
          Allow this agent to save team-visible notes as cited evidence. Saving notes does not
          approve canonical record changes.
        </span>
      </span>
    </label>
  );
}

function ReportingControls({
  membership,
  mode,
  scope,
  onModeChange,
  onScopeChange,
  capture,
}: {
  membership: ConsentMembership;
  mode: Mode;
  scope: string;
  onModeChange: (value: Mode) => void;
  onScopeChange: (value: string) => void;
  capture: boolean;
}) {
  const canManage = membership.role !== 'member';
  const effective =
    canManage && mode !== 'inherit'
      ? { mode, scope }
      : (membership.reporting.override ?? membership.reporting.defaults);
  const displayed = canManage && mode === 'inherit' ? membership.reporting.defaults : effective;
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-semibold text-fg">How should this agent report work?</legend>
      {canManage ? (
        <label className="block text-sm">
          Reporting agreement
          <select
            value={mode}
            onChange={(event) => {
              onModeChange(event.target.value as Mode);
            }}
            className="mt-1 block w-full rounded-md border border-border bg-bg p-2"
          >
            <option value="inherit">Use workspace default</option>
            <option value="on_request">Only when I ask</option>
            <option value="handoffs">After meaningful work or a handoff</option>
          </select>
        </label>
      ) : (
        <p className="text-sm text-fg-muted">
          Workspace owners and admins manage reporting preferences. You can still approve or deny
          this connection.
        </p>
      )}
      {canManage && mode === 'handoffs' ? (
        <label className="block text-sm">
          Project or work scope
          <Input
            value={scope}
            onChange={(event) => {
              onScopeChange(event.target.value);
            }}
            maxLength={1000}
            required
            placeholder="Acme website rebuild: implementation, decisions, blockers, and handoffs."
          />
        </label>
      ) : null}
      <p className="text-sm">
        Effective agreement:{' '}
        {displayed.mode === 'handoffs' ? 'After meaningful work or a handoff' : 'Only when I ask'}
        {displayed.mode === 'handoffs' && displayed.scope ? ` — ${displayed.scope}` : ''}
      </p>
      {!capture && displayed.mode === 'handoffs' ? (
        <p className="text-sm text-fg-muted">
          Reporting is inactive without capture permission. This read-only connection can still
          retrieve context.
        </p>
      ) : null}
      <p className="text-xs leading-5 text-fg-muted">
        Reporting happens while the agent works and follows the Timeline skill. This does not
        schedule background activity or add permissions.
      </p>
    </fieldset>
  );
}
