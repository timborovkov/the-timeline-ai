'use client';

import { useActionState } from 'react';

import { setEventVisibilityAction } from '@/app/actions/visibility';

interface MemberOption {
  id: string;
  label: string;
}

export function EventVisibilityForm({
  eventId,
  visibility,
  visibilityUserIds,
  members,
}: {
  eventId: string;
  visibility: string;
  visibilityUserIds: string[] | null;
  members: MemberOption[];
}) {
  const [state, action, pending] = useActionState(setEventVisibilityAction, {});

  return (
    <form
      action={action}
      className="mt-2 flex flex-wrap items-center gap-2 rounded-sm border border-border p-2"
    >
      <input type="hidden" name="id" value={eventId} />
      <select
        name="visibility"
        defaultValue={visibility}
        className="h-8 rounded-sm border border-border bg-bg px-2 text-xs"
      >
        <option value="team">Team</option>
        <option value="private">Private</option>
        <option value="specific_users">Specific users</option>
      </select>
      <div className="flex flex-wrap gap-2">
        {members.map((m) => (
          <label key={m.id} className="flex items-center gap-1 text-fg-muted">
            <input
              type="checkbox"
              name="visibilityUserIds"
              value={m.id}
              defaultChecked={visibilityUserIds?.includes(m.id) ?? false}
            />
            {m.label}
          </label>
        ))}
      </div>
      <button
        type="submit"
        disabled={pending}
        className="h-8 rounded-sm border border-border px-2 text-xs hover:bg-surface-2 disabled:opacity-60"
      >
        {pending ? 'Saving' : 'Save'}
      </button>
      {state.error ? <p className="basis-full text-xs text-destructive">{state.error}</p> : null}
      {state.ok ? <p className="basis-full text-xs text-fg-muted">Saved</p> : null}
    </form>
  );
}
