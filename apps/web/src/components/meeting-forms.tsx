'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useReducer, useState } from 'react';

import type { SavedMeetingRow } from '@timeline/shared/meetings';

import {
  archiveSavedMeetingAction,
  cancelMeetingBotAction,
  createSavedMeetingAction,
  joinSavedMeetingAction,
  scheduleMeetingBotAction,
  skipScheduledMeetingAction,
  updateSavedMeetingAction,
} from '@/app/actions/meetings';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DEFAULT_TIMEZONE, timezoneOptions } from '@/lib/timezones';

const EMPTY_MEMBERS: { id: string; label: string }[] = [];
type Visibility = 'team' | 'private' | 'specific_users';
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

function browserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIMEZONE;
}

function formString(form: FormData, key: string, fallback = ''): string {
  const value = form.get(key);
  return typeof value === 'string' ? value : fallback;
}

function formNumber(form: FormData, key: string, fallback: number): number {
  const value = Number(form.get(key) ?? fallback);
  return Number.isFinite(value) ? value : fallback;
}

function formAliases(form: FormData): string[] {
  return formString(form, 'aliases')
    .split(',')
    .flatMap((alias) => {
      const trimmed = alias.trim();
      return trimmed ? [trimmed] : [];
    });
}

function formTimes(form: FormData): string[] {
  return formString(form, 'times')
    .split(',')
    .flatMap((time) => {
      const trimmed = time.trim();
      return trimmed ? [trimmed] : [];
    });
}

function formWeekdays(form: FormData): number[] {
  return ['0', '1', '2', '3', '4', '5', '6']
    .filter((day) => form.get(`weekday-${day}`) === 'on')
    .map((day) => Number(day));
}

function formScheduleConfig(form: FormData, scheduled: boolean) {
  const times = formTimes(form);
  const weekdays = formWeekdays(form);
  return scheduled && times.length > 0 && weekdays.length > 0
    ? {
        weekdays,
        times,
        timezone: formString(form, 'timezone', DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE,
        joinOffsetMinutes: formNumber(form, 'joinOffsetMinutes', 2),
      }
    : null;
}

interface ScheduleMeetingState {
  pending: boolean;
  error: string | null;
  visibility: Visibility;
  visibilityUserIds: string[];
  consent: boolean;
}
type ScheduleMeetingAction =
  | { type: 'pending'; pending: boolean }
  | { type: 'error'; error: string | null }
  | { type: 'visibility'; visibility: Visibility }
  | { type: 'visibilityUserIds'; visibilityUserIds: string[] }
  | { type: 'consent'; consent: boolean };

function scheduleMeetingReducer(
  state: ScheduleMeetingState,
  action: ScheduleMeetingAction,
): ScheduleMeetingState {
  switch (action.type) {
    case 'pending':
      return { ...state, pending: action.pending };
    case 'error':
      return { ...state, error: action.error };
    case 'visibility':
      return { ...state, visibility: action.visibility };
    case 'visibilityUserIds':
      return { ...state, visibilityUserIds: action.visibilityUserIds };
    case 'consent':
      return { ...state, consent: action.consent };
  }
}

interface SavedMeetingState {
  pending: boolean;
  error: string | null;
  visibility: Visibility;
  visibilityUserIds: string[];
  scheduled: boolean;
  autoJoin: boolean;
  timezone: string;
}

type SavedMeetingAction =
  | { type: 'pending'; pending: boolean }
  | { type: 'error'; error: string | null }
  | { type: 'visibility'; visibility: Visibility }
  | { type: 'visibilityUserIds'; visibilityUserIds: string[] }
  | { type: 'scheduled'; scheduled: boolean }
  | { type: 'autoJoin'; autoJoin: boolean }
  | { type: 'timezone'; timezone: string };

function savedMeetingReducer(
  state: SavedMeetingState,
  action: SavedMeetingAction,
): SavedMeetingState {
  switch (action.type) {
    case 'pending':
      return { ...state, pending: action.pending };
    case 'error':
      return { ...state, error: action.error };
    case 'visibility':
      return { ...state, visibility: action.visibility };
    case 'visibilityUserIds':
      return { ...state, visibilityUserIds: action.visibilityUserIds };
    case 'scheduled':
      return {
        ...state,
        scheduled: action.scheduled,
        autoJoin: action.scheduled ? state.autoJoin : false,
      };
    case 'autoJoin':
      return { ...state, autoJoin: action.autoJoin };
    case 'timezone':
      return { ...state, timezone: action.timezone };
  }
}

function TimezoneSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (timezone: string) => void;
}) {
  const options = useMemo(() => timezoneOptions(value), [value]);
  return (
    <select
      id={id}
      name="timezone"
      value={value}
      onChange={(event) => {
        onChange(event.target.value);
      }}
      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      {options.map((timezone) => (
        <option key={timezone} value={timezone}>
          {timezone}
        </option>
      ))}
    </select>
  );
}

function NumberWithUnit({
  id,
  name,
  defaultValue,
  min,
  max,
}: {
  id: string;
  name: string;
  defaultValue: number;
  min?: number;
  max?: number;
}) {
  return (
    <div className="relative">
      <Input
        id={id}
        name={name}
        type="number"
        min={min}
        max={max}
        defaultValue={defaultValue}
        className="pr-16"
      />
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
        min
      </span>
    </div>
  );
}

function ScheduleFields({
  idPrefix,
  timezone,
  onTimezoneChange,
  times,
  weekdays,
  durationMinutes,
  joinOffsetMinutes,
  compact = false,
}: {
  idPrefix: string;
  timezone: string;
  onTimezoneChange: (timezone: string) => void;
  times?: string[];
  weekdays?: number[];
  durationMinutes: number;
  joinOffsetMinutes: number;
  compact?: boolean;
}) {
  return (
    <div className="space-y-4 rounded-md border bg-surface/40 p-4">
      <div className="grid gap-4 md:grid-cols-[minmax(0,1.15fr)_minmax(14rem,1fr)]">
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-times`}>Start times</Label>
          <Input
            id={`${idPrefix}-times`}
            name="times"
            defaultValue={times?.join(', ') ?? ''}
            placeholder="09:00, 16:30"
            inputMode="text"
          />
          <p className="text-xs text-muted-foreground">
            Use 24-hour local times, separated by commas.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-timezone`}>Timezone</Label>
          <TimezoneSelect
            id={`${idPrefix}-timezone`}
            value={timezone}
            onChange={onTimezoneChange}
          />
          <p className="text-xs text-muted-foreground">Defaults to your current timezone.</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-duration`}>Meeting duration</Label>
          <NumberWithUnit
            id={`${idPrefix}-duration`}
            name="durationMinutes"
            min={1}
            defaultValue={durationMinutes}
          />
          <p className="text-xs text-muted-foreground">How long Timeline should expect the call.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-join-offset`}>Join before start</Label>
          <NumberWithUnit
            id={`${idPrefix}-join-offset`}
            name="joinOffsetMinutes"
            min={0}
            max={30}
            defaultValue={joinOffsetMinutes}
          />
          <p className="text-xs text-muted-foreground">Lead time before each scheduled start.</p>
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Repeat on</legend>
        <div className="flex flex-wrap gap-2">
          {WEEKDAYS.map((label, index) => (
            <label
              key={label}
              className="flex h-9 min-w-14 items-center justify-center gap-1.5 rounded-sm border px-2 text-sm"
            >
              <input
                name={`weekday-${index}`}
                type="checkbox"
                defaultChecked={weekdays?.includes(index) ?? (index > 0 && index < 6)}
              />
              {compact ? label.slice(0, 1) : label}
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

export function ScheduleMeetingBotForm({
  defaultVisibility = 'team',
  defaultVisibilityUserIds = null,
  members = EMPTY_MEMBERS,
}: {
  defaultVisibility?: Visibility;
  defaultVisibilityUserIds?: string[] | null;
  members?: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [{ pending, error, visibility, visibilityUserIds, consent }, dispatch] = useReducer(
    scheduleMeetingReducer,
    {
      pending: false,
      error: null,
      visibility: defaultVisibility,
      visibilityUserIds: defaultVisibilityUserIds ?? [],
      consent: false,
    },
  );

  async function onSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const formElement = e.currentTarget;
    dispatch({ type: 'error', error: null });
    dispatch({ type: 'pending', pending: true });
    const form = new FormData(formElement);
    const rawUrl = form.get('meetingUrl');
    const rawTitle = form.get('title');
    const meetingUrl = (typeof rawUrl === 'string' ? rawUrl : '').trim();
    const title = (typeof rawTitle === 'string' ? rawTitle : '').trim();
    try {
      const res = await scheduleMeetingBotAction({
        meetingUrl,
        title: title || undefined,
        visibility,
        visibilityUserIds: visibility === 'specific_users' ? visibilityUserIds : [],
        consentGiven: consent,
      });
      if (!res.ok) {
        dispatch({ type: 'error', error: res.error ?? 'Failed to invite notetaker' });
        return;
      }
      if (res.meetingId) {
        router.push(`/app/meetings/${res.meetingId}`);
      } else {
        router.refresh();
      }
    } finally {
      dispatch({ type: 'pending', pending: false });
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-lg border p-4">
      <div className="space-y-2">
        <Label htmlFor="meetingUrl">Meeting URL</Label>
        <Input
          id="meetingUrl"
          name="meetingUrl"
          required
          type="url"
          placeholder="https://meet.google.com/abc-defg-hij"
        />
        <p className="text-xs text-muted-foreground">
          Google Meet, Microsoft Teams, or Zoom links are supported. The Timeline notetaker joins
          silently and captures the transcript.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="title">Title (optional)</Label>
        <Input id="title" name="title" placeholder="Weekly product sync" />
      </div>
      <div className="space-y-2">
        <Label>Visibility</Label>
        <div className="flex gap-2">
          <Button
            type="button"
            variant={visibility === 'team' ? 'default' : 'outline'}
            size="sm"
            onClick={() => {
              dispatch({ type: 'visibility', visibility: 'team' });
            }}
          >
            Team
          </Button>
          <Button
            type="button"
            variant={visibility === 'private' ? 'default' : 'outline'}
            size="sm"
            onClick={() => {
              dispatch({ type: 'visibility', visibility: 'private' });
            }}
          >
            Private
          </Button>
          <Button
            type="button"
            variant={visibility === 'specific_users' ? 'default' : 'outline'}
            size="sm"
            onClick={() => {
              dispatch({ type: 'visibility', visibility: 'specific_users' });
            }}
          >
            Specific users
          </Button>
        </div>
        {visibility === 'specific_users' ? (
          <div className="flex flex-wrap gap-3">
            {members.map((m) => (
              <label key={m.id} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={visibilityUserIds.includes(m.id)}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...new Set([...visibilityUserIds, m.id])]
                      : visibilityUserIds.filter((id) => id !== m.id);
                    dispatch({ type: 'visibilityUserIds', visibilityUserIds: next });
                  }}
                />
                {m.label}
              </label>
            ))}
          </div>
        ) : null}
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => {
            dispatch({ type: 'consent', consent: e.target.checked });
          }}
          className="mt-1"
        />
        <span>
          I confirm that everyone in the meeting will be informed the Timeline notetaker is joining
          and capturing the transcript.
        </span>
      </label>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? 'Inviting…' : 'Invite notetaker'}
      </Button>
    </form>
  );
}

export function CancelMeetingButton({ meetingId }: { meetingId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        try {
          await cancelMeetingBotAction(meetingId);
          router.refresh();
        } finally {
          setPending(false);
        }
      }}
    >
      {pending ? 'Cancelling…' : 'Cancel notetaker'}
    </Button>
  );
}

export function SavedMeetingForm({
  defaultVisibility = 'team',
  defaultVisibilityUserIds = null,
  defaultTimezone = 'UTC',
  members = EMPTY_MEMBERS,
}: {
  defaultVisibility?: Visibility;
  defaultVisibilityUserIds?: string[] | null;
  defaultTimezone?: string;
  members?: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [
    { pending, error, visibility, visibilityUserIds, scheduled, autoJoin, timezone },
    dispatch,
  ] = useReducer(savedMeetingReducer, {
    pending: false,
    error: null,
    visibility: defaultVisibility,
    visibilityUserIds: defaultVisibilityUserIds ?? [],
    scheduled: false,
    autoJoin: false,
    timezone: defaultTimezone,
  });

  useEffect(() => {
    dispatch({ type: 'timezone', timezone: browserTimezone() });
  }, []);

  async function onSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const formElement = e.currentTarget;
    dispatch({ type: 'error', error: null });
    dispatch({ type: 'pending', pending: true });
    const form = new FormData(formElement);
    const scheduleConfig = formScheduleConfig(form, scheduled);
    try {
      const result = await createSavedMeetingAction({
        title: formString(form, 'title').trim(),
        description: formString(form, 'description').trim() || undefined,
        meetingUrl: formString(form, 'meetingUrl').trim(),
        aliases: formAliases(form),
        visibility,
        visibilityUserIds: visibility === 'specific_users' ? visibilityUserIds : [],
        permissionConfirmed: form.get('permissionConfirmed') === 'on',
        scheduleConfig,
        durationMinutes: formNumber(form, 'durationMinutes', 30),
        autoJoinEnabled: scheduled && autoJoin,
      });
      if (!result.ok) {
        dispatch({ type: 'error', error: result.error ?? 'Failed to save meeting' });
        return;
      }
      router.refresh();
      formElement.reset();
      dispatch({ type: 'scheduled', scheduled: false });
      dispatch({ type: 'autoJoin', autoJoin: false });
      dispatch({ type: 'timezone', timezone: browserTimezone() });
    } finally {
      dispatch({ type: 'pending', pending: false });
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-lg border p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="saved-title">Title</Label>
          <Input id="saved-title" name="title" required placeholder="Internal daily meeting" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="saved-url">Meeting URL</Label>
          <Input
            id="saved-url"
            name="meetingUrl"
            required
            type="url"
            placeholder="https://meet.google.com/abc-defg-hij"
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="saved-description">Description</Label>
        <Input
          id="saved-description"
          name="description"
          placeholder="Engineering sync for launch readiness"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="saved-aliases">Aliases</Label>
        <Input id="saved-aliases" name="aliases" placeholder="daily, standup, team call" />
        <p className="text-xs text-muted-foreground">
          Works with commands like /join daily or /timeline join standup.
        </p>
      </div>
      <div className="space-y-2">
        <Label>Visibility</Label>
        <div className="flex flex-wrap gap-2">
          {(['team', 'private', 'specific_users'] as const).map((value) => (
            <Button
              key={value}
              type="button"
              variant={visibility === value ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                dispatch({ type: 'visibility', visibility: value });
              }}
            >
              {value === 'specific_users'
                ? 'Specific users'
                : `${value[0]?.toUpperCase()}${value.slice(1)}`}
            </Button>
          ))}
        </div>
        {visibility === 'specific_users' ? (
          <div className="flex flex-wrap gap-3">
            {members.map((m) => (
              <label key={m.id} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={visibilityUserIds.includes(m.id)}
                  onChange={(event) => {
                    dispatch({
                      type: 'visibilityUserIds',
                      visibilityUserIds: event.target.checked
                        ? [...new Set([...visibilityUserIds, m.id])]
                        : visibilityUserIds.filter((id) => id !== m.id),
                    });
                  }}
                />
                {m.label}
              </label>
            ))}
          </div>
        ) : null}
      </div>
      <div className="space-y-3 rounded-md border border-dashed p-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={scheduled}
            onChange={(event) => {
              dispatch({ type: 'scheduled', scheduled: event.target.checked });
            }}
          />
          Add a recurring schedule
        </label>
        {scheduled ? (
          <div className="space-y-4">
            <ScheduleFields
              idPrefix="saved"
              timezone={timezone}
              onTimezoneChange={(next) => {
                dispatch({ type: 'timezone', timezone: next });
              }}
              durationMinutes={30}
              joinOffsetMinutes={2}
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={autoJoin}
                onChange={(event) => {
                  dispatch({ type: 'autoJoin', autoJoin: event.target.checked });
                }}
              />
              Auto-join scheduled occurrences
            </label>
          </div>
        ) : null}
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input name="permissionConfirmed" type="checkbox" className="mt-1" />
        <span>
          I confirm this team has permission for Timeline to capture this saved meeting whenever a
          teammate joins or auto-join is enabled.
        </span>
      </label>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Save meeting'}
      </Button>
    </form>
  );
}

export function EditSavedMeetingForm({
  saved,
  defaultTimezone = 'UTC',
  members = EMPTY_MEMBERS,
}: {
  saved: SavedMeetingRow;
  defaultTimezone?: string;
  members?: { id: string; label: string }[];
}) {
  const router = useRouter();
  const schedule = saved.scheduleConfig;
  const [
    { pending, error, visibility, visibilityUserIds, scheduled, autoJoin, timezone },
    dispatch,
  ] = useReducer(savedMeetingReducer, {
    pending: false,
    error: null,
    visibility: saved.defaultVisibility,
    visibilityUserIds: saved.visibilityUserIds ?? [],
    scheduled: Boolean(schedule),
    autoJoin: saved.autoJoinEnabled,
    timezone: schedule?.timezone ?? defaultTimezone,
  });

  function onScheduleToggle(checked: boolean) {
    dispatch({ type: 'scheduled', scheduled: checked });
    if (checked && !schedule) dispatch({ type: 'timezone', timezone: browserTimezone() });
  }

  async function onSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    dispatch({ type: 'error', error: null });
    dispatch({ type: 'pending', pending: true });
    const form = new FormData(e.currentTarget);
    const scheduleConfig = formScheduleConfig(form, scheduled);
    try {
      const result = await updateSavedMeetingAction({
        savedMeetingId: saved.id,
        title: formString(form, 'title').trim(),
        description: formString(form, 'description').trim() || undefined,
        aliases: formAliases(form),
        visibility,
        visibilityUserIds: visibility === 'specific_users' ? visibilityUserIds : [],
        scheduleConfig,
        durationMinutes: formNumber(form, 'durationMinutes', saved.durationMinutes),
        autoJoinEnabled: scheduled && autoJoin,
      });
      if (!result.ok) {
        dispatch({ type: 'error', error: result.error ?? 'Failed to update meeting' });
        return;
      }
      router.refresh();
    } finally {
      dispatch({ type: 'pending', pending: false });
    }
  }

  return (
    <details className="space-y-3 text-sm">
      <summary className="cursor-pointer text-muted-foreground">Edit saved meeting</summary>
      <form onSubmit={onSubmit} className="space-y-4 pt-3">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={`saved-title-${saved.id}`}>Title</Label>
            <Input
              id={`saved-title-${saved.id}`}
              name="title"
              required
              defaultValue={saved.title}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`saved-aliases-${saved.id}`}>Aliases</Label>
            <Input
              id={`saved-aliases-${saved.id}`}
              name="aliases"
              defaultValue={saved.aliases.join(', ')}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`saved-description-${saved.id}`}>Description</Label>
          <Input
            id={`saved-description-${saved.id}`}
            name="description"
            defaultValue={saved.description ?? ''}
          />
        </div>
        <div className="space-y-2">
          <Label>Visibility</Label>
          <div className="flex flex-wrap gap-2">
            {(['team', 'private', 'specific_users'] as const).map((value) => (
              <Button
                key={value}
                type="button"
                variant={visibility === value ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  dispatch({ type: 'visibility', visibility: value });
                }}
              >
                {value === 'specific_users'
                  ? 'Specific users'
                  : `${value[0]?.toUpperCase()}${value.slice(1)}`}
              </Button>
            ))}
          </div>
          {visibility === 'specific_users' ? (
            <div className="flex flex-wrap gap-3">
              {members.map((m) => (
                <label
                  key={m.id}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground"
                >
                  <input
                    type="checkbox"
                    checked={visibilityUserIds.includes(m.id)}
                    onChange={(event) => {
                      dispatch({
                        type: 'visibilityUserIds',
                        visibilityUserIds: event.target.checked
                          ? [...new Set([...visibilityUserIds, m.id])]
                          : visibilityUserIds.filter((id) => id !== m.id),
                      });
                    }}
                  />
                  {m.label}
                </label>
              ))}
            </div>
          ) : null}
        </div>
        <div className="space-y-3 rounded-md border border-dashed p-3">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={scheduled}
              onChange={(event) => {
                onScheduleToggle(event.target.checked);
              }}
            />
            Add a recurring schedule
          </label>
          {scheduled ? (
            <div className="space-y-4">
              <ScheduleFields
                idPrefix={`saved-${saved.id}`}
                timezone={timezone}
                onTimezoneChange={(next) => {
                  dispatch({ type: 'timezone', timezone: next });
                }}
                times={schedule?.times}
                weekdays={schedule?.weekdays}
                durationMinutes={saved.durationMinutes}
                joinOffsetMinutes={schedule?.joinOffsetMinutes ?? 2}
                compact
              />
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={autoJoin}
                  onChange={(event) => {
                    dispatch({ type: 'autoJoin', autoJoin: event.target.checked });
                  }}
                />
                Auto-join scheduled occurrences
              </label>
            </div>
          ) : null}
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Updating…' : 'Update meeting'}
        </Button>
      </form>
    </details>
  );
}

export function JoinSavedMeetingButton({ query }: { query: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <Button
      size="sm"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        try {
          const result = await joinSavedMeetingAction({ query });
          if (result.meetingId) router.push(`/app/meetings/${result.meetingId}`);
          else router.refresh();
        } finally {
          setPending(false);
        }
      }}
    >
      {pending ? 'Joining…' : 'Join'}
    </Button>
  );
}

export function ArchiveSavedMeetingButton({ savedMeetingId }: { savedMeetingId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        try {
          await archiveSavedMeetingAction(savedMeetingId);
          router.refresh();
        } finally {
          setPending(false);
        }
      }}
    >
      {pending ? 'Archiving…' : 'Archive'}
    </Button>
  );
}

export function SkipScheduledMeetingButton({ meetingId }: { meetingId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        try {
          await skipScheduledMeetingAction(meetingId);
          router.refresh();
        } finally {
          setPending(false);
        }
      }}
    >
      {pending ? 'Skipping…' : 'Skip once'}
    </Button>
  );
}
