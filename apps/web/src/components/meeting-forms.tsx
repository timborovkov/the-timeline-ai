'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useMemo, useReducer, useRef, useState } from 'react';

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
const VISIBILITY_OPTIONS: { value: Visibility; label: string }[] = [
  { value: 'team', label: 'Team' },
  { value: 'private', label: 'Private' },
  { value: 'specific_users', label: 'Specific users' },
];

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

function FormError({
  errorRef,
  message,
}: {
  errorRef: React.RefObject<HTMLParagraphElement | null>;
  message: string | null;
}) {
  return (
    <p
      ref={errorRef}
      hidden={!message}
      role={message ? 'alert' : undefined}
      tabIndex={-1}
      className="rounded-sm border border-danger/40 p-3 text-sm text-danger"
    >
      {message ?? ''}
    </p>
  );
}

function focusFormError(errorRef: React.RefObject<HTMLParagraphElement | null>) {
  setTimeout(() => {
    errorRef.current?.focus();
  });
}

function ActionError({ id, message }: { id: string; message: string | null }) {
  if (!message) return null;

  return (
    <p id={id} role="alert" className="text-sm text-danger">
      {message}
    </p>
  );
}

function VisibilityField({
  idPrefix,
  visibility,
  visibilityUserIds,
  members,
  onVisibilityChange,
  onVisibilityUserIdsChange,
}: {
  idPrefix: string;
  visibility: Visibility;
  visibilityUserIds: string[];
  members: { id: string; label: string }[];
  onVisibilityChange: (visibility: Visibility) => void;
  onVisibilityUserIdsChange: (visibilityUserIds: string[]) => void;
}) {
  const descriptionId = `${idPrefix}-visibility-description`;

  return (
    <fieldset aria-describedby={descriptionId} className="space-y-2">
      <legend className="text-sm font-medium">Visibility</legend>
      <p id={descriptionId} className="text-xs text-muted-foreground">
        Choose who can access this meeting and its transcript.
      </p>
      <div className="flex flex-wrap gap-2">
        {VISIBILITY_OPTIONS.map((option) => {
          const inputId = `${idPrefix}-visibility-${option.value}`;
          return (
            <label key={option.value} htmlFor={inputId} className="cursor-pointer">
              <input
                checked={visibility === option.value}
                className="peer sr-only"
                id={inputId}
                name={`${idPrefix}-visibility`}
                onChange={() => {
                  onVisibilityChange(option.value);
                }}
                type="radio"
                value={option.value}
              />
              <span className="inline-flex min-h-9 items-center rounded-sm border border-input px-3 text-sm font-medium text-fg transition-colors hover:bg-surface-2 peer-checked:border-signal peer-checked:bg-signal-soft peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2">
                {option.label}
              </span>
            </label>
          );
        })}
      </div>
      {visibility === 'specific_users' ? (
        <fieldset className="space-y-2 pt-1">
          <legend className="text-xs font-medium text-fg-muted">People with access</legend>
          {members.length > 0 ? (
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {members.map((member) => {
                const inputId = `${idPrefix}-member-${member.id}`;
                return (
                  <label
                    key={member.id}
                    htmlFor={inputId}
                    className="flex items-center gap-2 text-sm text-fg-muted"
                  >
                    <input
                      checked={visibilityUserIds.includes(member.id)}
                      id={inputId}
                      onChange={(event) => {
                        onVisibilityUserIdsChange(
                          event.target.checked
                            ? [...new Set([...visibilityUserIds, member.id])]
                            : visibilityUserIds.filter((id) => id !== member.id),
                        );
                      }}
                      type="checkbox"
                    />
                    {member.label}
                  </label>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No teammates are available to add.</p>
          )}
        </fieldset>
      ) : null}
    </fieldset>
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
  const errorRef = useRef<HTMLParagraphElement>(null);
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

  function showError(message: string) {
    dispatch({ type: 'error', error: message });
    focusFormError(errorRef);
  }

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
        showError(res.error ?? 'Unable to invite the notetaker. Try again.');
        return;
      }
      if (res.meetingId) {
        router.push(`/app/meetings/${res.meetingId}`);
      } else {
        router.refresh();
      }
    } catch {
      showError('Unable to invite the notetaker. Try again.');
    } finally {
      dispatch({ type: 'pending', pending: false });
    }
  }

  return (
    <form
      aria-busy={pending}
      onSubmit={onSubmit}
      className="space-y-4 rounded-md border border-border bg-surface p-4"
    >
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
        <Label htmlFor="title">Meeting title (optional)</Label>
        <Input id="title" name="title" placeholder="Weekly product sync" />
      </div>
      <VisibilityField
        idPrefix="invite-notetaker"
        members={members}
        onVisibilityChange={(nextVisibility) => {
          dispatch({ type: 'visibility', visibility: nextVisibility });
        }}
        onVisibilityUserIdsChange={(nextVisibilityUserIds) => {
          dispatch({ type: 'visibilityUserIds', visibilityUserIds: nextVisibilityUserIds });
        }}
        visibility={visibility}
        visibilityUserIds={visibilityUserIds}
      />
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
      <FormError errorRef={errorRef} message={error} />
      <Button type="submit" disabled={pending}>
        {pending ? 'Inviting notetaker…' : 'Invite notetaker'}
      </Button>
    </form>
  );
}

export function CancelMeetingButton({ meetingId }: { meetingId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  return (
    <div className="space-y-2">
      <Button
        aria-describedby={error ? errorId : undefined}
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={async () => {
          setError(null);
          setPending(true);
          try {
            const result = await cancelMeetingBotAction(meetingId);
            if (!result.ok) {
              setError(result.error ?? 'Unable to cancel the notetaker. Try again.');
              return;
            }
            router.refresh();
          } catch {
            setError('Unable to cancel the notetaker. Try again.');
          } finally {
            setPending(false);
          }
        }}
      >
        {pending ? 'Cancelling notetaker…' : 'Cancel notetaker'}
      </Button>
      <ActionError id={errorId} message={error} />
    </div>
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
  const errorRef = useRef<HTMLParagraphElement>(null);
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

  function showError(message: string) {
    dispatch({ type: 'error', error: message });
    focusFormError(errorRef);
  }

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
        showError(result.error ?? 'Unable to save the meeting. Try again.');
        return;
      }
      router.refresh();
      formElement.reset();
      dispatch({ type: 'scheduled', scheduled: false });
      dispatch({ type: 'autoJoin', autoJoin: false });
      dispatch({ type: 'timezone', timezone: browserTimezone() });
    } catch {
      showError('Unable to save the meeting. Try again.');
    } finally {
      dispatch({ type: 'pending', pending: false });
    }
  }

  return (
    <form
      aria-busy={pending}
      onSubmit={onSubmit}
      className="space-y-4 rounded-md border border-border bg-surface p-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="saved-title">Meeting title</Label>
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
          <p className="text-xs text-muted-foreground">
            Google Meet, Microsoft Teams, and Zoom links are supported.
          </p>
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
      <VisibilityField
        idPrefix="save-meeting"
        members={members}
        onVisibilityChange={(nextVisibility) => {
          dispatch({ type: 'visibility', visibility: nextVisibility });
        }}
        onVisibilityUserIdsChange={(nextVisibilityUserIds) => {
          dispatch({ type: 'visibilityUserIds', visibilityUserIds: nextVisibilityUserIds });
        }}
        visibility={visibility}
        visibilityUserIds={visibilityUserIds}
      />
      <div className="space-y-3 rounded-md border border-border bg-surface-2/40 p-3">
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
      <FormError errorRef={errorRef} message={error} />
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
  const errorRef = useRef<HTMLParagraphElement>(null);
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

  function showError(message: string) {
    dispatch({ type: 'error', error: message });
    focusFormError(errorRef);
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
        meetingUrl: formString(form, 'meetingUrl').trim(),
        aliases: formAliases(form),
        visibility,
        visibilityUserIds: visibility === 'specific_users' ? visibilityUserIds : [],
        scheduleConfig,
        durationMinutes: formNumber(form, 'durationMinutes', saved.durationMinutes),
        autoJoinEnabled: scheduled && autoJoin,
      });
      if (!result.ok) {
        showError(result.error ?? 'Unable to update the meeting. Try again.');
        return;
      }
      router.refresh();
    } catch {
      showError('Unable to update the meeting. Try again.');
    } finally {
      dispatch({ type: 'pending', pending: false });
    }
  }

  return (
    <details className="space-y-3 text-sm">
      <summary className="cursor-pointer rounded-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
        Edit saved meeting
      </summary>
      <form aria-busy={pending} onSubmit={onSubmit} className="space-y-4 pt-3">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={`saved-title-${saved.id}`}>Meeting title</Label>
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
          <Label htmlFor={`saved-meeting-url-${saved.id}`}>Meeting URL</Label>
          <Input
            id={`saved-meeting-url-${saved.id}`}
            name="meetingUrl"
            type="url"
            required
            defaultValue={saved.meetingUrl}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`saved-description-${saved.id}`}>Description</Label>
          <Input
            id={`saved-description-${saved.id}`}
            name="description"
            defaultValue={saved.description ?? ''}
          />
        </div>
        <VisibilityField
          idPrefix={`edit-saved-meeting-${saved.id}`}
          members={members}
          onVisibilityChange={(nextVisibility) => {
            dispatch({ type: 'visibility', visibility: nextVisibility });
          }}
          onVisibilityUserIdsChange={(nextVisibilityUserIds) => {
            dispatch({ type: 'visibilityUserIds', visibilityUserIds: nextVisibilityUserIds });
          }}
          visibility={visibility}
          visibilityUserIds={visibilityUserIds}
        />
        <div className="space-y-3 rounded-md border border-border bg-surface-2/40 p-3">
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
        <FormError errorRef={errorRef} message={error} />
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
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  return (
    <div className="space-y-2">
      <Button
        aria-describedby={error ? errorId : undefined}
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={async () => {
          setError(null);
          setPending(true);
          try {
            const result = await joinSavedMeetingAction({ query });
            if (!result.ok) {
              setError(result.error ?? 'Unable to join the meeting. Try again.');
              return;
            }
            if (result.meetingId) router.push(`/app/meetings/${result.meetingId}`);
            else router.refresh();
          } catch {
            setError('Unable to join the meeting. Try again.');
          } finally {
            setPending(false);
          }
        }}
      >
        {pending ? 'Joining meeting…' : 'Join meeting'}
      </Button>
      <ActionError id={errorId} message={error} />
    </div>
  );
}

export function ArchiveSavedMeetingButton({ savedMeetingId }: { savedMeetingId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  return (
    <div className="space-y-2">
      <Button
        aria-describedby={error ? errorId : undefined}
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={async () => {
          setError(null);
          setPending(true);
          try {
            const result = await archiveSavedMeetingAction(savedMeetingId);
            if (!result.ok) {
              setError(result.error ?? 'Unable to archive the saved meeting. Try again.');
              return;
            }
            router.refresh();
          } catch {
            setError('Unable to archive the saved meeting. Try again.');
          } finally {
            setPending(false);
          }
        }}
      >
        {pending ? 'Archiving meeting…' : 'Archive meeting'}
      </Button>
      <ActionError id={errorId} message={error} />
    </div>
  );
}

export function SkipScheduledMeetingButton({ meetingId }: { meetingId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  return (
    <div className="space-y-2">
      <Button
        aria-describedby={error ? errorId : undefined}
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={async () => {
          setError(null);
          setPending(true);
          try {
            const result = await skipScheduledMeetingAction(meetingId);
            if (!result.ok) {
              setError(result.error ?? 'Unable to skip this occurrence. Try again.');
              return;
            }
            router.refresh();
          } catch {
            setError('Unable to skip this occurrence. Try again.');
          } finally {
            setPending(false);
          }
        }}
      >
        {pending ? 'Skipping occurrence…' : 'Skip this occurrence'}
      </Button>
      <ActionError id={errorId} message={error} />
    </div>
  );
}
