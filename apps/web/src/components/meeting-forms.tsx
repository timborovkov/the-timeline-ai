'use client';

import { useRouter } from 'next/navigation';
import { useReducer, useState } from 'react';

import { cancelMeetingBotAction, scheduleMeetingBotAction } from '@/app/actions/meetings';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const EMPTY_MEMBERS: { id: string; label: string }[] = [];
type Visibility = 'team' | 'private' | 'specific_users';
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
