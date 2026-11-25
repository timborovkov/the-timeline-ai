'use client';

import {
  DEFAULT_UPDATE_KEY,
  UPDATE_CHANNELS,
  UPDATE_WEEKDAYS,
  type UpdateSettings,
} from '@timeline/shared/messaging/format';
import Link from 'next/link';
import { useActionState, useState } from 'react';

import { saveUpdateAction } from '@/app/actions/updates';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { UpdateContentFields } from '@/components/updates/update-content-fields';

const field = 'grid gap-1.5 text-sm font-medium text-fg';
const hint = 'text-xs leading-relaxed font-normal text-fg-muted';
const box = 'size-4 shrink-0 accent-signal';

export function UpdateEditor({
  teamId,
  scheduleKey,
  initial,
  timezone,
  workspace,
  inherited,
  creating,
}: {
  teamId: string;
  scheduleKey: string;
  initial: UpdateSettings;
  timezone: string;
  workspace: boolean;
  inherited: boolean;
  creating: boolean;
}) {
  const [state, submit, pending] = useActionState(saveUpdateAction, {});
  const [draft, setDraft] = useState(initial);

  function change<K extends keyof UpdateSettings>(key: K, value: UpdateSettings[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  const defaultSchedule = scheduleKey === DEFAULT_UPDATE_KEY;
  return (
    <form action={submit} className="overflow-hidden rounded-md border border-border bg-surface">
      <input type="hidden" name="team" value={teamId} />
      <input type="hidden" name="key" value={scheduleKey} />
      <input type="hidden" name="scope" value={workspace ? 'workspace' : 'personal'} />
      <fieldset disabled={pending} className="space-y-6 p-4 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={field}>
            Name
            <Input
              name="name"
              required
              maxLength={60}
              value={draft.name}
              onChange={(event) => {
                change('name', event.currentTarget.value);
              }}
            />
          </label>
          <label className={field}>
            Deliver to
            <NativeSelect
              name="channel"
              value={draft.channel}
              onChange={(event) => {
                change('channel', event.currentTarget.value as UpdateSettings['channel']);
              }}
            >
              {UPDATE_CHANNELS.map((channel) => (
                <option key={channel.value} value={channel.value}>
                  {channel.label}
                </option>
              ))}
            </NativeSelect>
          </label>
          {draft.channel !== 'email' && (
            <p className={`${hint} sm:col-span-2`}>
              {draft.channel === 'workspace' ? (
                'Uses the personal destinations configured in Team settings.'
              ) : (
                <>
                  DMs start after you link your account in{' '}
                  <Link href="/app/connections" className="underline underline-offset-3">
                    Connections
                  </Link>
                  .
                </>
              )}
            </p>
          )}
        </div>

        <fieldset className="space-y-3 border-t border-border pt-4">
          <legend className="pr-3 text-sm font-semibold text-fg">Schedule</legend>
          <div className="grid items-start gap-4 sm:grid-cols-3">
            <label className={field}>
              Frequency
              <NativeSelect
                name="cadence"
                value={draft.cadence}
                onChange={(event) => {
                  change('cadence', event.currentTarget.value as UpdateSettings['cadence']);
                }}
              >
                <option value="daily">Every day</option>
                <option value="weekly">Every week</option>
              </NativeSelect>
            </label>
            {draft.cadence === 'weekly' ? (
              <label className={field}>
                Day
                <NativeSelect
                  name="weekday"
                  aria-label="Day"
                  value={draft.weekday}
                  onChange={(event) => {
                    change('weekday', Number(event.currentTarget.value));
                  }}
                >
                  {UPDATE_WEEKDAYS.map((day, index) => (
                    <option key={day} value={index + 1}>
                      {day}
                    </option>
                  ))}
                </NativeSelect>
              </label>
            ) : (
              <input type="hidden" name="weekday" value={draft.weekday} />
            )}
            <label className={field}>
              Send time
              <Input
                type="time"
                name="time"
                value={draft.time}
                onChange={(event) => {
                  change('time', event.currentTarget.value);
                }}
                required
              />
              <span className={hint}>{timezone.replaceAll('_', ' ')}</span>
            </label>
          </div>
        </fieldset>

        <UpdateContentFields draft={draft} includeSavedViews={defaultSchedule} change={change} />
        <label className="flex cursor-pointer items-start gap-3 text-sm font-medium text-fg">
          <input
            className={box}
            type="checkbox"
            name="enabled"
            checked={draft.enabled}
            onChange={(event) => {
              change('enabled', event.currentTarget.checked);
            }}
          />
          <span>{workspace ? 'Enable for members using this default' : 'Send this update'}</span>
        </label>
      </fieldset>
      {state.error && (
        <p role="alert" className="px-4 pb-3 text-sm text-danger sm:px-6">
          {state.error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3 sm:px-6">
        <Button type="submit" name="intent" value="save" disabled={pending}>
          {pending ? 'Saving…' : 'Save schedule'}
        </Button>
        <Button asChild variant="ghost">
          <Link href="/app/updates">Cancel</Link>
        </Button>
        {!workspace && defaultSchedule && !inherited && (
          <Button
            type="submit"
            name="intent"
            value="reset"
            variant="outline"
            formNoValidate
            disabled={pending}
            className="sm:ml-auto"
          >
            Use workspace default
          </Button>
        )}
        {!workspace && !defaultSchedule && !creating && (
          <Button
            type="submit"
            name="intent"
            value="delete"
            variant="ghost"
            formNoValidate
            disabled={pending}
            className="text-danger sm:ml-auto"
          >
            Remove schedule
          </Button>
        )}
      </div>
    </form>
  );
}
