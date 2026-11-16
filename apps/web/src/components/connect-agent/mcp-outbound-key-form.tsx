import type { RefObject, SyntheticEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function McpOutboundKeyForm({
  keyNameId,
  keyNameErrorId,
  keyNameRef,
  name,
  nameError,
  allowCapture,
  allowAgent,
  allowWebsiteScan,
  allowWebsiteManage,
  onAllowWebsiteScanChange,
  onAllowWebsiteManageChange,
  busy,
  allowAgentDescription,
  onNameChange,
  onAllowCaptureChange,
  onAllowAgentChange,
  onSubmit,
}: {
  keyNameId: string;
  keyNameErrorId: string;
  keyNameRef: RefObject<HTMLInputElement | null>;
  name: string;
  nameError: string | null;
  allowCapture: boolean;
  allowAgent: boolean;
  allowWebsiteScan: boolean;
  allowWebsiteManage: boolean;
  onAllowWebsiteScanChange: (value: boolean) => void;
  onAllowWebsiteManageChange: (value: boolean) => void;
  busy: boolean;
  allowAgentDescription: string;
  onNameChange: (value: string) => void;
  onAllowCaptureChange: (value: boolean) => void;
  onAllowAgentChange: (value: boolean) => void;
  onSubmit: (event: SyntheticEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className="space-y-3 py-4" noValidate onSubmit={onSubmit} aria-busy={busy}>
      <div className="space-y-1">
        <Label htmlFor={keyNameId}>
          Label <span aria-hidden="true">(required)</span>
        </Label>
        <Input
          ref={keyNameRef}
          id={keyNameId}
          name="mcp-key-label"
          autoComplete="off"
          required
          value={name}
          onChange={(event) => {
            onNameChange(event.target.value);
          }}
          placeholder="Claude Desktop · personal mac"
          aria-invalid={nameError ? true : undefined}
          aria-describedby={nameError ? keyNameErrorId : undefined}
        />
        {nameError ? (
          <p id={keyNameErrorId} role="alert" className="text-xs text-danger">
            {nameError}
          </p>
        ) : null}
      </div>
      <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-sm border border-border bg-surface-2 p-3">
        <input
          type="checkbox"
          name="allow-capture"
          className="mt-0.5 size-4 shrink-0"
          checked={allowCapture}
          onChange={(event) => {
            onAllowCaptureChange(event.currentTarget.checked);
          }}
        />
        <span className="space-y-1">
          <span className="block text-sm font-medium text-fg">Allow capture notes</span>
          <span className="block text-xs leading-5 text-fg-muted">
            This key can store cited Timeline evidence with timeline.remember. Capture is on by
            default. Uncheck it for a read-only key.
          </span>
        </span>
      </label>
      <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-sm border border-border bg-surface-2 p-3">
        <input
          type="checkbox"
          name="allow-agent"
          className="mt-0.5 size-4 shrink-0"
          checked={allowAgent}
          onChange={(event) => {
            onAllowAgentChange(event.currentTarget.checked);
          }}
        />
        <span className="space-y-1">
          <span className="block text-sm font-medium text-fg">Allow Timeline agent</span>
          <span className="block text-xs leading-5 text-fg-muted">{allowAgentDescription}</span>
        </span>
      </label>
      <label className="flex min-h-11 items-start gap-3 border border-border p-3">
        <input
          type="checkbox"
          checked={allowWebsiteScan}
          onChange={(event) => {
            onAllowWebsiteScanChange(event.currentTarget.checked);
          }}
          className="mt-1 size-4"
        />
        <span>
          <span className="block text-sm font-medium">Allow website scans</span>
          <span className="text-xs text-fg-muted">
            Can scan public websites after permission confirmation. Each captured page uses 20
            source units.
          </span>
        </span>
      </label>
      <label className="flex min-h-11 items-start gap-3 border border-border p-3">
        <input
          type="checkbox"
          checked={allowWebsiteManage}
          onChange={(event) => {
            onAllowWebsiteManageChange(event.currentTarget.checked);
          }}
          className="mt-1 size-4"
        />
        <span>
          <span className="block text-sm font-medium">Allow website management</span>
          <span className="text-xs text-fg-muted">
            Includes scanning, schedules and archiving through the HTTP API. Requires the issuing
            admin to retain admin access.
          </span>
        </span>
      </label>
      <Button type="submit" size="sm" disabled={busy}>
        {busy ? 'Create key · creating…' : 'Create key'}
      </Button>
    </form>
  );
}
