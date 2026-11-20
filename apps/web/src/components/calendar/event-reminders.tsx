'use client';

import { Bell } from 'lucide-react';
import { useId, useState } from 'react';

import {
  changeEventReminder,
  changeEventReminderBlock,
  getEventReminder,
} from '@/app/actions/calendar-automation';
import { CalendarEventDisclosure } from '@/components/calendar/calendar-event-disclosure';
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
    try {
      await notifyAction({
        id: `calendar:reminder:${eventId}`,
        loading: 'Saving reminder settings…',
        success: 'Reminder settings saved',
        error: 'Couldn’t save reminder settings',
        run,
      });
      await refresh();
    } finally {
      setPending(false);
    }
  }

  const blocked = preferences?.eventBlocked === true || preferences?.seriesBlocked === true;
  let summary: string | undefined;
  if (blocked) summary = 'Blocked';
  else if (preferences)
    summary = preferences.leadMinutes ? reminderLeadLabel(preferences.leadMinutes) : 'Off';

  return (
    <CalendarEventDisclosure
      icon={Bell}
      label="Reminders"
      value={summary}
      onToggle={(open) => {
        if (open) void refresh();
      }}
    >
      {preferences ? (
        <div className="space-y-3">
          {blocked ? (
            <p className="text-sm text-fg-muted">
              Reminders are blocked for everyone{' '}
              {preferences.seriesBlocked ? 'in this series' : 'for this event'}.
            </p>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="text-sm font-medium" htmlFor={inputId}>
              My reminder
            </label>
            <NativeSelect
              id={inputId}
              className="w-auto min-w-36 max-w-full"
              value={preferences.leadMinutes ?? ''}
              disabled={pending}
              onChange={(event) => {
                const lead = event.currentTarget.value;
                void update(() => changeEventReminder(eventId, lead ? Number(lead) : null));
              }}
            >
              <option value="">Off</option>
              {LEAD_TIMES.map((lead) => (
                <option key={lead} value={lead} disabled={blocked || preferences.started}>
                  {reminderLeadLabel(lead)}
                </option>
              ))}
            </NativeSelect>
          </div>
          <OrganizerReminderControls
            preferences={preferences}
            pending={pending}
            eventId={eventId}
            update={update}
          />
        </div>
      ) : (
        <p className="text-sm text-fg-muted">
          {loaded ? 'Reminders are unavailable.' : 'Loading settings…'}
        </p>
      )}
    </CalendarEventDisclosure>
  );
}

function reminderLeadLabel(lead: number): string {
  if (lead === 1440) return '1 day before';
  if (lead === 60) return '1 hour before';
  return `${lead} minutes before`;
}

function OrganizerReminderControls({
  preferences,
  pending,
  eventId,
  update,
}: {
  preferences: NonNullable<Awaited<ReturnType<typeof getEventReminder>>>;
  pending: boolean;
  eventId: string;
  update: (run: () => Promise<{ ok: boolean; error?: string }>) => Promise<void>;
}) {
  if (!preferences.canBlock) return null;
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          void update(() => changeEventReminderBlock(eventId, !preferences.eventBlocked, false))
        }
      >
        {preferences.eventBlocked ? 'Allow event reminders' : 'Block reminders for everyone'}
      </Button>
      {preferences.hasSeries ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() =>
            void update(() => changeEventReminderBlock(eventId, !preferences.seriesBlocked, true))
          }
        >
          {preferences.seriesBlocked ? 'Allow series reminders' : 'Block reminders for the series'}
        </Button>
      ) : null}
    </div>
  );
}
