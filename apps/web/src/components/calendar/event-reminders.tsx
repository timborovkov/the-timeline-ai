'use client';

import { useId, useState } from 'react';

import {
  changeEventReminder,
  changeEventReminderBlock,
  getEventReminder,
} from '@/app/actions/calendar-automation';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { notifyAction } from '@/lib/notify';

const LEAD_TIMES = [5, 10, 15, 30, 60, 1440];

export function EventReminders({ eventId }: { eventId: string }) {
  const [preferences, setPreferences] =
    useState<Awaited<ReturnType<typeof getEventReminder>>>(null);
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState(false);
  const inputId = useId();

  async function refresh() {
    try {
      setPreferences(await getEventReminder(eventId));
    } catch {
      setPreferences(null);
    } finally {
      setLoaded(true);
    }
  }

  async function update(run: () => Promise<{ ok: boolean; error?: string }>) {
    setPending(true);
    await notifyAction({
      id: `calendar:reminder:${eventId}`,
      loading: 'Saving reminder settings…',
      success: 'Reminder settings saved',
      error: 'Couldn’t save reminder settings',
      run,
    });
    await refresh();
    setPending(false);
  }

  const blocked = preferences?.eventBlocked || preferences?.seriesBlocked;
  return (
    <details
      className="space-y-3 rounded-md border p-3"
      onToggle={(event) => {
        if (event.currentTarget.open) void refresh();
      }}
    >
      <summary className="cursor-pointer text-sm font-medium">Reminders</summary>
      {preferences ? (
        <div className="space-y-3">
          {blocked ? (
            <p className="text-sm text-fg-muted">
              Reminders are blocked for everyone{' '}
              {preferences.seriesBlocked ? 'in this series' : 'for this event'}.
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm" htmlFor={inputId}>
              My reminder
            </label>
            <NativeSelect
              id={inputId}
              value={preferences.leadMinutes ?? ''}
              disabled={pending}
              onChange={(event) => {
                const lead = event.currentTarget.value;
                void update(() => changeEventReminder(eventId, lead ? Number(lead) : null));
              }}
            >
              <option value="">Off</option>
              {LEAD_TIMES.map((lead) => (
                <option key={lead} value={lead} disabled={Boolean(blocked) || preferences.started}>
                  {lead === 1440 ? '1 day before' : `${lead} minutes before`}
                </option>
              ))}
            </NativeSelect>
          </div>
          {preferences.canBlock ? (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  void update(() =>
                    changeEventReminderBlock(eventId, !preferences.eventBlocked, false),
                  )
                }
              >
                {preferences.eventBlocked
                  ? 'Allow event reminders'
                  : 'Block reminders for everyone'}
              </Button>
              {preferences.hasSeries ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    void update(() =>
                      changeEventReminderBlock(eventId, !preferences.seriesBlocked, true),
                    )
                  }
                >
                  {preferences.seriesBlocked
                    ? 'Allow series reminders'
                    : 'Block reminders for the series'}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-fg-muted">
          {loaded ? 'Reminders are unavailable.' : 'Loading settings…'}
        </p>
      )}
    </details>
  );
}
