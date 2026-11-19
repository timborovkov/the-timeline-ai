'use client';

import { useState } from 'react';

import {
  disconnectGoogleCalendar,
  listGoogleCalendarChoices,
  selectGoogleCalendar,
} from '@/app/actions/calendar-automation';
import { RelativeTimestamp } from '@/components/relative-timestamp';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { notifyAction } from '@/lib/notify';

export interface GoogleCalendarImportState {
  calendarName: string | null;
  lastSyncAt: string | null;
  syncStatus: string | null;
}

export function GoogleCalendarImport({
  connection,
  error,
  available,
}: {
  connection: GoogleCalendarImportState | null;
  error: boolean;
  available: boolean;
}) {
  const [choices, setChoices] = useState<{ id: string; name: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const reconnect = connection?.syncStatus === 'reconnect';

  async function loadChoices() {
    setBusy(true);
    const result = await notifyAction({
      id: 'calendar:choices',
      loading: 'Loading calendars…',
      success: 'Calendars loaded',
      error: 'Couldn’t load your calendars',
      run: listGoogleCalendarChoices,
    });
    if ('choices' in result && result.choices) setChoices(result.choices);
    setBusy(false);
  }

  if (!connection && !available && !error) return null;
  return (
    <section className="space-y-3 rounded-lg border p-4" aria-labelledby="google-calendar-title">
      <div className="space-y-1">
        <h2 id="google-calendar-title" className="font-medium">
          Google Calendar import
        </h2>
        <p className="text-sm text-fg-muted">
          Import one calendar. Only you can see event details. Teammates see busy time.
        </p>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          Google Calendar couldn’t connect.
        </p>
      ) : null}
      {connection?.calendarName ? (
        <p className="text-sm">
          {connection.calendarName}
          <span className="ml-2 text-fg-muted">
            {connection.lastSyncAt ? (
              <>
                Last synced <RelativeTimestamp value={connection.lastSyncAt} />
              </>
            ) : (
              'Waiting for first sync'
            )}
          </span>
        </p>
      ) : null}
      {reconnect ? (
        <p className="text-sm text-fg-muted">Reconnect Google Calendar to resume sync.</p>
      ) : null}
      {connection?.syncStatus === 'retrying' ? (
        <p className="text-sm text-fg-muted">Sync is delayed. Timeline will retry.</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {!connection || reconnect ? (
          <form method="post" action="/api/calendar/google">
            <Button size="sm" variant="outline" type="submit">
              {reconnect ? 'Reconnect Google Calendar' : 'Connect Google Calendar'}
            </Button>
          </form>
        ) : (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void loadChoices()}>
            {connection.calendarName ? 'Change calendar' : 'Choose calendar'}
          </Button>
        )}
        {connection ? (
          <Button
            size="sm"
            variant="ghost"
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void notifyAction({
                id: 'calendar:disconnect',
                loading: 'Disconnecting…',
                success: 'Google Calendar disconnected',
                error: 'Couldn’t disconnect calendar',
                run: disconnectGoogleCalendar,
              }).then(() => {
                setBusy(false);
                setChoices(null);
              });
            }}
          >
            Disconnect
          </Button>
        ) : null}
      </div>
      {choices?.length ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const calendarId = String(new FormData(event.currentTarget).get('calendar') ?? '');
            setBusy(true);
            void notifyAction({
              id: 'calendar:select',
              loading: 'Selecting calendar…',
              success: 'Calendar selected',
              error: 'Couldn’t select calendar',
              run: () => selectGoogleCalendar(calendarId),
            }).then((result) => {
              setBusy(false);
              if (!result.error) setChoices(null);
            });
          }}
        >
          <label className="space-y-1 text-sm">
            <span className="block">Calendar to import</span>
            <NativeSelect name="calendar" required defaultValue="">
              <option value="" disabled>
                Select a calendar
              </option>
              {choices.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.name}
                </option>
              ))}
            </NativeSelect>
          </label>
          <Button size="sm" type="submit" disabled={busy}>
            Import this calendar
          </Button>
        </form>
      ) : choices ? (
        <p className="text-sm text-fg-muted">Google returned no calendars you can import.</p>
      ) : null}
    </section>
  );
}
