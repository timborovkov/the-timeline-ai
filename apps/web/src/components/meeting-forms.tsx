'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { cancelMeetingBotAction, scheduleMeetingBotAction } from '@/app/actions/meetings';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function ScheduleMeetingBotForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<'team' | 'private'>('team');
  const [consent, setConsent] = useState(false);

  async function onSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
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
        consentGiven: consent,
      });
      if (!res.ok) {
        setError(res.error ?? 'Failed to invite notetaker');
        return;
      }
      if (res.meetingId) {
        router.push(`/app/meetings/${res.meetingId}`);
      } else {
        router.refresh();
      }
    } finally {
      setPending(false);
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
              setVisibility('team');
            }}
          >
            Team
          </Button>
          <Button
            type="button"
            variant={visibility === 'private' ? 'default' : 'outline'}
            size="sm"
            onClick={() => {
              setVisibility('private');
            }}
          >
            Private
          </Button>
        </div>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => {
            setConsent(e.target.checked);
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
