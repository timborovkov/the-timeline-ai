'use client';

import { useActionState, useEffect, useEffectEvent, useId, useRef, useState } from 'react';

import { setEventVisibilityAction } from '@/app/actions/visibility';
import { FormActionToast } from '@/components/form-action-toast';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';

interface MemberOption {
  id: string;
  label: string;
}

export interface SavedEventVisibility {
  visibility: string;
  visibilityUserIds: string[];
}

export function EventVisibilityForm({
  eventId,
  visibility,
  visibilityUserIds,
  members,
  onSaved,
}: {
  eventId: string;
  visibility: string;
  visibilityUserIds: string[] | null;
  members: MemberOption[];
  onSaved?: (value: SavedEventVisibility) => void;
}) {
  const [state, action, pending] = useActionState(setEventVisibilityAction, {});
  const formKey = `${eventId}:${visibility}:${(visibilityUserIds ?? []).join(',')}`;
  const [selectedVisibility, setSelectedVisibility] = useState(visibility);
  const selectId = useId();
  const lastSubmittedRef = useRef<SavedEventVisibility | null>(null);
  const notifiedStateRef = useRef<typeof state | null>(null);
  const notifySaved = useEffectEvent(() => {
    const submitted = lastSubmittedRef.current;
    if (submitted) onSaved?.(submitted);
  });

  useEffect(() => {
    if (!state.ok || notifiedStateRef.current === state) return;
    notifiedStateRef.current = state;
    notifySaved();
  }, [state]);

  return (
    <form
      key={formKey}
      action={action}
      onSubmit={(event) => {
        const data = new FormData(event.currentTarget);
        const visibilityValue = data.get('visibility');
        lastSubmittedRef.current = {
          visibility: typeof visibilityValue === 'string' ? visibilityValue : 'team',
          visibilityUserIds: data
            .getAll('visibilityUserIds')
            .filter((value): value is string => typeof value === 'string'),
        };
      }}
      className="mt-2 grid gap-3 border-y border-border py-3"
    >
      <input type="hidden" name="id" value={eventId} />
      <div className="grid gap-1.5">
        <label htmlFor={selectId} className="text-xs font-medium text-fg">
          Who can see this evidence?
        </label>
        <NativeSelect
          id={selectId}
          name="visibility"
          value={selectedVisibility}
          onChange={(e) => {
            setSelectedVisibility(e.currentTarget.value);
          }}
          className="h-8"
        >
          <option value="team">Team</option>
          <option value="private">Private</option>
          <option value="specific_users">Specific people</option>
        </NativeSelect>
      </div>
      {selectedVisibility === 'specific_users' ? (
        <fieldset className="grid gap-2">
          <legend className="text-xs font-medium text-fg">People with access</legend>
          <div className="flex flex-wrap gap-x-3 gap-y-2">
            {members.map((m) => (
              <label key={m.id} className="flex min-h-8 items-center gap-1.5 text-fg-muted">
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
        </fieldset>
      ) : null}
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? 'Saving…' : 'Save visibility'}
      </Button>
      <FormActionToast
        id={`event-visibility:${eventId}`}
        error={state.error}
        success={state.ok ? 'Visibility saved' : undefined}
      />
    </form>
  );
}
