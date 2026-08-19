'use client';

import { Archive, LogIn, SkipForward } from 'lucide-react';
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
import { ItemIconButton } from '@/components/ui/item-actions';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { notifyAction } from '@/lib/notify';
import { DEFAULT_TIMEZONE, timezoneOptions } from '@/lib/timezones';

const EMPTY_MEMBERS: { id: string; label: string }[] = [];
const INCOMPLETE_SCHEDULE_ERROR =
  'Add at least one start time and one day before saving a schedule.';
type Visibility = 'team' | 'private' | 'specific_users';
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;
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
  scheduleError: 'times' | 'weekdays' | 'both' | null;
  visibility: Visibility;
  visibilityUserIds: string[];
  scheduled: boolean;
  autoJoin: boolean;
  timezone: string;
}

type SavedMeetingAction =
  | { type: 'pending'; pending: boolean }
  | { type: 'error'; error: string | null }
  | { type: 'scheduleError'; scheduleError: SavedMeetingState['scheduleError'] }
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
    case 'scheduleError':
      return { ...state, scheduleError: action.scheduleError };
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
    <NativeSelect
      id={id}
      name="timezone"
      value={value}
      onChange={(event) => {
        onChange(event.target.value);
      }}
    >
      {options.map((timezone) => (
        <option key={timezone} value={timezone}>
          {timezone}
        </option>
      ))}
    </NativeSelect>
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
        aria-describedby={`${id}-unit`}
        type="number"
        min={min}
        max={max}
        defaultValue={defaultValue}
        className="pr-16"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground"
      >
        min
      </span>
      <span id={`${id}-unit`} className="sr-only">
        minutes
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
  timesInvalid = false,
  weekdaysInvalid = false,
  errorId,
  onScheduleFieldChange,
}: {
  idPrefix: string;
  timezone: string;
  onTimezoneChange: (timezone: string) => void;
  times?: string[];
  weekdays?: number[];
  durationMinutes: number;
  joinOffsetMinutes: number;
  compact?: boolean;
  timesInvalid?: boolean;
  weekdaysInvalid?: boolean;
  errorId?: string;
  onScheduleFieldChange?: () => void;
}) {
  const timesHelpId = `${idPrefix}-times-help`;
  const timesDescribedBy = timesInvalid && errorId ? `${timesHelpId} ${errorId}` : timesHelpId;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-[minmax(0,1.15fr)_minmax(14rem,1fr)]">
        <div className="space-y-2">
          <Label size="sm" htmlFor={`${idPrefix}-times`}>
            Start times
          </Label>
          <Input
            id={`${idPrefix}-times`}
            name="times"
            defaultValue={times?.join(', ') ?? ''}
            placeholder="09:00, 16:30"
            inputMode="text"
            onChange={onScheduleFieldChange}
            aria-describedby={timesDescribedBy}
            aria-invalid={timesInvalid || undefined}
          />
          <p id={timesHelpId} className="text-xs text-fg-dim">
            Use 24-hour local times, separated by commas.
          </p>
        </div>
        <div className="space-y-2">
          <Label size="sm" htmlFor={`${idPrefix}-timezone`}>
            Timezone
          </Label>
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
          <Label size="sm" htmlFor={`${idPrefix}-duration`}>
            Meeting duration
          </Label>
          <NumberWithUnit
            id={`${idPrefix}-duration`}
            name="durationMinutes"
            min={1}
            defaultValue={durationMinutes}
          />
          <p className="text-xs text-muted-foreground">How long Timeline should expect the call.</p>
        </div>
        <div className="space-y-2">
          <Label size="sm" htmlFor={`${idPrefix}-join-offset`}>
            Join before start
          </Label>
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

      <fieldset
        aria-describedby={weekdaysInvalid ? errorId : undefined}
        aria-invalid={weekdaysInvalid || undefined}
        className="space-y-2"
      >
        <legend className="text-sm font-medium">Repeat on</legend>
        <div className="flex flex-wrap gap-1.5">
          {WEEKDAYS.map((label, index) => (
            <label
              key={label}
              className={
                compact
                  ? 'cursor-pointer'
                  : 'flex h-9 min-w-14 items-center justify-center gap-1.5 rounded-sm border px-2 text-sm'
              }
            >
              <input
                aria-label={compact ? WEEKDAY_NAMES[index] : undefined}
                className={compact ? 'peer sr-only' : undefined}
                name={`weekday-${index}`}
                onChange={onScheduleFieldChange}
                type="checkbox"
                defaultChecked={weekdays?.includes(index) ?? (index > 0 && index < 6)}
              />
              {compact ? (
                <span className="inline-flex size-8 items-center justify-center rounded-sm border border-border text-xs text-fg-muted transition-colors hover:bg-surface-2 peer-checked:border-signal peer-checked:bg-signal-soft peer-checked:text-fg peer-focus-visible:ring-2 peer-focus-visible:ring-signal/40">
                  {label.slice(0, 1)}
                </span>
              ) : (
                label
              )}
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
  id,
}: {
  errorRef: React.RefObject<HTMLParagraphElement | null>;
  message: string | null;
  id?: string;
}) {
  return (
    <p
      ref={errorRef}
      id={id}
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
  const [{ pending, visibility, visibilityUserIds, consent }, dispatch] = useReducer(
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
    dispatch({ type: 'pending', pending: true });
    const form = new FormData(formElement);
    const rawUrl = form.get('meetingUrl');
    const rawTitle = form.get('title');
    const meetingUrl = (typeof rawUrl === 'string' ? rawUrl : '').trim();
    const title = (typeof rawTitle === 'string' ? rawTitle : '').trim();
    const result = await notifyAction({
      id: 'meeting:invite',
      loading: 'Inviting notetaker…',
      success: 'Notetaker invited',
      error: 'Couldn’t invite notetaker',
      run: () =>
        scheduleMeetingBotAction({
          meetingUrl,
          title: title || undefined,
          visibility,
          visibilityUserIds: visibility === 'specific_users' ? visibilityUserIds : [],
          consentGiven: consent,
        }),
    });
    dispatch({ type: 'pending', pending: false });
    if (result.error) return;
    if ('meetingId' in result && result.meetingId) {
      router.push(`/app/meetings/${result.meetingId}`);
    } else {
      router.refresh();
    }
  }

  return (
    <form aria-busy={pending} onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label size="sm" htmlFor="meetingUrl">
          Meeting URL
        </Label>
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
        <Label size="sm" htmlFor="title">
          Meeting title (optional)
        </Label>
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
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? 'Inviting notetaker…' : 'Invite notetaker'}
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
      onClick={() => {
        setPending(true);
        void notifyAction({
          id: `meeting:${meetingId}:cancel`,
          loading: 'Cancelling notetaker…',
          success: 'Notetaker cancelled',
          error: 'Couldn’t cancel notetaker',
          run: () => cancelMeetingBotAction(meetingId),
        }).then((result) => {
          setPending(false);
          if (!result.error) router.refresh();
        });
      }}
    >
      {pending ? 'Cancelling notetaker…' : 'Cancel notetaker'}
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
  const errorRef = useRef<HTMLParagraphElement>(null);
  const errorId = useId();
  const [
    { pending, error, scheduleError, visibility, visibilityUserIds, scheduled, autoJoin, timezone },
    dispatch,
  ] = useReducer(savedMeetingReducer, {
    pending: false,
    error: null,
    scheduleError: null,
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
    const form = new FormData(formElement);
    const scheduleConfig = formScheduleConfig(form, scheduled);
    if (scheduled && !scheduleConfig) {
      const times = formTimes(form);
      const weekdays = formWeekdays(form);
      dispatch({
        type: 'scheduleError',
        scheduleError:
          times.length === 0 && weekdays.length === 0
            ? 'both'
            : times.length === 0
              ? 'times'
              : 'weekdays',
      });
      showError(INCOMPLETE_SCHEDULE_ERROR);
      return;
    }
    dispatch({ type: 'scheduleError', scheduleError: null });
    dispatch({ type: 'pending', pending: true });
    const result = await notifyAction({
      id: 'meeting:save',
      loading: 'Saving meeting…',
      success: 'Meeting saved',
      error: 'Couldn’t save meeting',
      run: () =>
        createSavedMeetingAction({
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
        }),
    });
    dispatch({ type: 'pending', pending: false });
    if (result.error) return;
    router.refresh();
    formElement.reset();
    dispatch({ type: 'scheduled', scheduled: false });
    dispatch({ type: 'autoJoin', autoJoin: false });
    dispatch({ type: 'timezone', timezone: browserTimezone() });
  }

  return (
    <form aria-busy={pending} onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label size="sm" htmlFor="saved-title">
            Meeting title
          </Label>
          <Input id="saved-title" name="title" required placeholder="Internal daily meeting" />
        </div>
        <div className="space-y-2">
          <Label size="sm" htmlFor="saved-url">
            Meeting URL
          </Label>
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
        <Label size="sm" htmlFor="saved-description">
          Description
        </Label>
        <Input
          id="saved-description"
          name="description"
          placeholder="Engineering sync for launch readiness"
        />
      </div>
      <div className="space-y-2">
        <Label size="sm" htmlFor="saved-aliases">
          Aliases
        </Label>
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
      <div className="space-y-3 border-y border-border py-3">
        <label className="flex min-h-9 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={scheduled}
            onChange={(event) => {
              dispatch({ type: 'scheduled', scheduled: event.target.checked });
              dispatch({ type: 'error', error: null });
              dispatch({ type: 'scheduleError', scheduleError: null });
            }}
            className="size-4 rounded-sm border-input accent-signal"
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
              timesInvalid={scheduleError === 'times' || scheduleError === 'both'}
              weekdaysInvalid={scheduleError === 'weekdays' || scheduleError === 'both'}
              errorId={errorId}
              onScheduleFieldChange={() => {
                dispatch({ type: 'error', error: null });
                dispatch({ type: 'scheduleError', scheduleError: null });
              }}
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
      <FormError errorRef={errorRef} id={errorId} message={error} />
      <Button type="submit" size="sm" disabled={pending}>
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
  const errorId = useId();
  const schedule = saved.scheduleConfig;
  const [
    { pending, error, scheduleError, visibility, visibilityUserIds, scheduled, autoJoin, timezone },
    dispatch,
  ] = useReducer(savedMeetingReducer, {
    pending: false,
    error: null,
    scheduleError: null,
    visibility: saved.defaultVisibility,
    visibilityUserIds: saved.visibilityUserIds ?? [],
    scheduled: Boolean(schedule),
    autoJoin: saved.autoJoinEnabled,
    timezone: schedule?.timezone ?? defaultTimezone,
  });

  function onScheduleToggle(checked: boolean) {
    dispatch({ type: 'scheduled', scheduled: checked });
    dispatch({ type: 'error', error: null });
    dispatch({ type: 'scheduleError', scheduleError: null });
    if (checked && !schedule) dispatch({ type: 'timezone', timezone: browserTimezone() });
  }

  function showError(message: string) {
    dispatch({ type: 'error', error: message });
    focusFormError(errorRef);
  }

  async function onSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    dispatch({ type: 'error', error: null });
    const form = new FormData(e.currentTarget);
    const scheduleConfig = formScheduleConfig(form, scheduled);
    if (scheduled && !scheduleConfig) {
      const times = formTimes(form);
      const weekdays = formWeekdays(form);
      dispatch({
        type: 'scheduleError',
        scheduleError:
          times.length === 0 && weekdays.length === 0
            ? 'both'
            : times.length === 0
              ? 'times'
              : 'weekdays',
      });
      showError(INCOMPLETE_SCHEDULE_ERROR);
      return;
    }
    dispatch({ type: 'scheduleError', scheduleError: null });
    dispatch({ type: 'pending', pending: true });
    const result = await notifyAction({
      id: `meeting:${saved.id}:update`,
      loading: 'Updating meeting…',
      success: 'Meeting updated',
      error: 'Couldn’t update meeting',
      run: () =>
        updateSavedMeetingAction({
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
        }),
    });
    dispatch({ type: 'pending', pending: false });
    if (!result.error) router.refresh();
  }

  return (
    <form aria-busy={pending} onSubmit={onSubmit} className="space-y-3">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label size="sm" htmlFor={`saved-title-${saved.id}`}>
            Meeting title
          </Label>
          <Input id={`saved-title-${saved.id}`} name="title" required defaultValue={saved.title} />
        </div>
        <div className="space-y-2">
          <Label size="sm" htmlFor={`saved-aliases-${saved.id}`}>
            Aliases
          </Label>
          <Input
            id={`saved-aliases-${saved.id}`}
            name="aliases"
            defaultValue={saved.aliases.join(', ')}
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label size="sm" htmlFor={`saved-meeting-url-${saved.id}`}>
          Meeting URL
        </Label>
        <Input
          id={`saved-meeting-url-${saved.id}`}
          name="meetingUrl"
          type="url"
          required
          defaultValue={saved.meetingUrl}
        />
      </div>
      <div className="space-y-2">
        <Label size="sm" htmlFor={`saved-description-${saved.id}`}>
          Description
        </Label>
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
      <div className="space-y-3 border-y border-border py-3">
        <label className="flex min-h-9 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={scheduled}
            onChange={(event) => {
              onScheduleToggle(event.target.checked);
            }}
            className="size-4 rounded-sm border-input accent-signal"
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
              timesInvalid={scheduleError === 'times' || scheduleError === 'both'}
              weekdaysInvalid={scheduleError === 'weekdays' || scheduleError === 'both'}
              errorId={errorId}
              onScheduleFieldChange={() => {
                dispatch({ type: 'error', error: null });
                dispatch({ type: 'scheduleError', scheduleError: null });
              }}
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
      <FormError errorRef={errorRef} id={errorId} message={error} />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? 'Updating…' : 'Update meeting'}
      </Button>
    </form>
  );
}

export function JoinSavedMeetingButton({ query }: { query: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <ItemIconButton
      disabled={pending}
      label="Join meeting"
      onClick={() => {
        setPending(true);
        void notifyAction({
          id: 'meeting:join',
          loading: 'Joining meeting…',
          success: 'Joining meeting',
          error: 'Couldn’t join meeting',
          run: () => joinSavedMeetingAction({ query }),
        }).then((result) => {
          setPending(false);
          if (result.error) return;
          if ('meetingId' in result && result.meetingId) {
            router.push(`/app/meetings/${result.meetingId}`);
            return;
          }
          router.refresh();
        });
      }}
    >
      <LogIn />
    </ItemIconButton>
  );
}

export function ArchiveSavedMeetingButton({ savedMeetingId }: { savedMeetingId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <ItemIconButton
      disabled={pending}
      label="Archive meeting"
      className="hover:text-danger"
      onClick={() => {
        setPending(true);
        void notifyAction({
          id: `meeting:${savedMeetingId}:archive`,
          loading: 'Archiving meeting…',
          success: 'Meeting archived',
          error: 'Couldn’t archive meeting',
          run: () => archiveSavedMeetingAction(savedMeetingId),
        }).then((result) => {
          setPending(false);
          if (!result.error) router.refresh();
        });
      }}
    >
      <Archive />
    </ItemIconButton>
  );
}

export function SkipScheduledMeetingButton({ meetingId }: { meetingId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <ItemIconButton
      disabled={pending}
      label="Skip this occurrence"
      onClick={() => {
        setPending(true);
        void notifyAction({
          id: `meeting:${meetingId}:skip`,
          loading: 'Skipping occurrence…',
          success: 'Occurrence skipped',
          error: 'Couldn’t skip occurrence',
          run: () => skipScheduledMeetingAction(meetingId),
        }).then((result) => {
          setPending(false);
          if (!result.error) router.refresh();
        });
      }}
    >
      <SkipForward />
    </ItemIconButton>
  );
}
