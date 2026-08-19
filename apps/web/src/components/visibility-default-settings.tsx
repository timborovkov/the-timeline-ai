'use client';

import { useActionState, useState } from 'react';

import { setVisibilityDefaultAction } from '@/app/actions/visibility';
import { FormActionToast } from '@/components/form-action-toast';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';

type Source =
  | 'team'
  | 'web'
  | 'telegram'
  | 'slack'
  | 'email'
  | 'document'
  | 'meeting'
  | 'integration'
  | 'calendar';
type Visibility = 'team' | 'private' | 'specific_users';

interface DefaultRow {
  source: Source;
  visibility: Visibility;
  visibilityUserIds: string[] | null;
  sourceOwnerUserId: string | null;
  inherited: boolean;
}

interface Member {
  id: string;
  label: string;
}

const SOURCE_LABEL: Record<Source, string> = {
  team: 'Team fallback',
  web: 'Web capture',
  telegram: 'Telegram',
  slack: 'Slack',
  email: 'Email',
  document: 'Documents',
  meeting: 'Meetings',
  integration: 'Integrations',
  calendar: 'External calendars',
};

const SPECIFIC_OK = new Set<Source>(['document', 'meeting', 'integration', 'calendar']);

export function VisibilityDefaultSettings({
  defaults,
  members,
}: {
  defaults: DefaultRow[];
  members: Member[];
}) {
  return (
    <div>
      {defaults.map((row) => {
        const userKey = (row.visibilityUserIds ?? []).join(',');
        return (
          <VisibilityDefaultForm
            key={`${row.source}:${row.sourceOwnerUserId ?? 'none'}:${row.visibility}:${userKey}`}
            row={row}
            members={members}
          />
        );
      })}
    </div>
  );
}

function VisibilityDefaultForm({ row, members }: { row: DefaultRow; members: Member[] }) {
  const [state, action, pending] = useActionState(setVisibilityDefaultAction, {});
  const specificAllowed = SPECIFIC_OK.has(row.source);
  const [selectedVisibility, setSelectedVisibility] = useState(row.visibility);
  return (
    <form action={action} className="border-b border-border/80 py-2 last:border-b-0">
      <input type="hidden" name="source" value={row.source} />
      <div className="flex min-h-11 flex-wrap items-center gap-2">
        <div className="min-w-40 flex-1">
          <p className="text-sm font-medium">{SOURCE_LABEL[row.source]}</p>
          <p className="text-[11px] text-fg-dim">
            {row.inherited ? 'Inherits fallback' : 'Explicit default'}
          </p>
        </div>
        <NativeSelect
          name="visibility"
          value={selectedVisibility}
          onChange={(e) => {
            setSelectedVisibility(e.currentTarget.value as Visibility);
            if (e.currentTarget.value !== 'specific_users') {
              e.currentTarget.form?.requestSubmit();
            }
          }}
          className="h-8 w-auto min-w-32"
        >
          <option value="team">Team</option>
          <option value="private">Private</option>
          {specificAllowed ? <option value="specific_users">Specific users</option> : null}
        </NativeSelect>
        <NativeSelect
          name="sourceOwnerUserId"
          defaultValue={row.sourceOwnerUserId ?? ''}
          className="h-8 w-auto min-w-36"
          onChange={(e) => {
            e.currentTarget.form?.requestSubmit();
          }}
        >
          <option value="">No source owner</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </NativeSelect>
        {selectedVisibility === 'specific_users' ? (
          <Button type="submit" size="sm" variant="outline" disabled={pending}>
            {pending ? 'Saving' : 'Save'}
          </Button>
        ) : null}
        <FormActionToast
          id={`visibility-default:${row.source}`}
          error={state.error}
          success={state.ok ? 'Visibility default saved' : undefined}
        />
      </div>
      {specificAllowed && selectedVisibility === 'specific_users' ? (
        <div className="flex flex-wrap gap-x-4 gap-y-2 pt-2">
          {members.map((m) => (
            <label key={m.id} className="flex items-center gap-1.5 text-xs text-fg-muted">
              <input
                type="checkbox"
                name="visibilityUserIds"
                value={m.id}
                defaultChecked={row.visibilityUserIds?.includes(m.id) ?? false}
              />
              {m.label}
            </label>
          ))}
        </div>
      ) : null}
    </form>
  );
}
