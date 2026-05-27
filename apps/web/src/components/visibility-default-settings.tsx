'use client';

import { useActionState } from 'react';

import { setVisibilityDefaultAction } from '@/app/actions/visibility';
import { Button } from '@/components/ui/button';

type Source =
  | 'team'
  | 'web'
  | 'telegram'
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
    <div className="space-y-3">
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
  return (
    <form action={action} className="space-y-2 rounded-sm border border-border p-3">
      <input type="hidden" name="source" value={row.source} />
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-40 flex-1">
          <p className="text-sm font-medium">{SOURCE_LABEL[row.source]}</p>
          <p className="text-xs text-muted-foreground">
            {row.inherited ? 'Inherits fallback' : 'Explicit default'}
          </p>
        </div>
        <select
          name="visibility"
          defaultValue={row.visibility}
          className="h-9 rounded-sm border border-border bg-bg px-2 text-sm"
        >
          <option value="team">Team</option>
          <option value="private">Private</option>
          {specificAllowed ? <option value="specific_users">Specific users</option> : null}
        </select>
        <select
          name="sourceOwnerUserId"
          defaultValue={row.sourceOwnerUserId ?? ''}
          className="h-9 rounded-sm border border-border bg-bg px-2 text-sm"
        >
          <option value="">No source owner</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <Button type="submit" size="sm" variant="secondary" disabled={pending}>
          {pending ? 'Saving' : 'Save'}
        </Button>
      </div>
      {specificAllowed ? (
        <div className="flex flex-wrap gap-3 border-t border-border/60 pt-2">
          {members.map((m) => (
            <label key={m.id} className="flex items-center gap-1.5 text-xs text-muted-foreground">
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
      {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
      {state.ok ? <p className="text-xs text-muted-foreground">Saved</p> : null}
    </form>
  );
}
