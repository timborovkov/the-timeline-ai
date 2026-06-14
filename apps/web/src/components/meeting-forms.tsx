'use client';

import { useRouter } from 'next/navigation';
import { useReducer, useState } from 'react';

import {
  archiveSavedMeetingAction,
  cancelMeetingBotAction,
  createSavedMeetingAction,
  joinSavedMeetingAction,
  scheduleMeetingBotAction,
  skipScheduledMeetingAction,
} from '@/app/actions/meetings';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const EMPTY_MEMBERS: { id: string; label: string }[] = [];
type Visibility = 'team' | 'private' | 'specific_users';

function formString(form: FormData, key: string, fallback = ''): string {
  const value = form.get(key);
  return typeof value === 'string' ? value : fallback;
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
}

type SavedMeetingAction =
  | { type: 'pending'; pending: boolean }
  | { type: 'error'; error: string | null }
  | { type: 'visibility'; visibility: Visibility }
  | { type: 'visibilityUserIds'; visibilityUserIds: string[] }
  | { type: 'scheduled'; scheduled: boolean }
  | { type: 'autoJoin'; autoJoin: boolean };

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
  }
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
    dispatch({ type: 'error', error: null });
    dispatch({ type: 'pending', pending: true });
    const form = new FormData(e.currentTarget);
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
  members = EMPTY_MEMBERS,
}: {
  defaultVisibility?: Visibility;
  defaultVisibilityUserIds?: string[] | null;
  members?: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [{ pending, error, visibility, visibilityUserIds, scheduled, autoJoin }, dispatch] =
    useReducer(savedMeetingReducer, {
      pending: false,
      error: null,
      visibility: defaultVisibility,
      visibilityUserIds: defaultVisibilityUserIds ?? [],
      scheduled: false,
      autoJoin: false,
    });

  async function onSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    dispatch({ type: 'error', error: null });
    dispatch({ type: 'pending', pending: true });
    const form = new FormData(e.currentTarget);
    const aliases = formString(form, 'aliases')
      .split(',')
      .flatMap((alias) => {
        const trimmed = alias.trim();
        return trimmed ? [trimmed] : [];
      });
    const times = formString(form, 'times')
      .split(',')
      .flatMap((time) => {
        const trimmed = time.trim();
        return trimmed ? [trimmed] : [];
      });
    const weekdays = ['0', '1', '2', '3', '4', '5', '6']
      .filter((day) => form.get(`weekday-${day}`) === 'on')
      .map((day) => Number(day));
    const scheduleConfig =
      scheduled && times.length > 0 && weekdays.length > 0
        ? {
            weekdays,
            times,
            timezone: formString(form, 'timezone', 'UTC').trim() || 'UTC',
            joinOffsetMinutes: 2,
          }
        : null;
    try {
      const result = await createSavedMeetingAction({
        title: formString(form, 'title').trim(),
        description: formString(form, 'description').trim() || undefined,
        meetingUrl: formString(form, 'meetingUrl').trim(),
        aliases,
        visibility,
        visibilityUserIds: visibility === 'specific_users' ? visibilityUserIds : [],
        permissionConfirmed: form.get('permissionConfirmed') === 'on',
        scheduleConfig,
        durationMinutes: Number(form.get('durationMinutes') ?? 30),
        autoJoinEnabled: scheduled && autoJoin,
      });
      if (!result.ok) {
        dispatch({ type: 'error', error: result.error ?? 'Failed to save meeting' });
        return;
      }
      router.refresh();
      e.currentTarget.reset();
      dispatch({ type: 'scheduled', scheduled: false });
      dispatch({ type: 'autoJoin', autoJoin: false });
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
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="saved-times">Times</Label>
                <Input id="saved-times" name="times" placeholder="16:00, 10:00" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="saved-timezone">Timezone</Label>
                <Input id="saved-timezone" name="timezone" defaultValue="UTC" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="saved-duration">Duration</Label>
                <Input id="saved-duration" name="durationMinutes" type="number" defaultValue={30} />
              </div>
            </div>
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label, index) => (
                <label key={label} className="flex items-center gap-1.5">
                  <input
                    name={`weekday-${index}`}
                    type="checkbox"
                    defaultChecked={index > 0 && index < 6}
                  />
                  {label}
                </label>
              ))}
            </div>
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
