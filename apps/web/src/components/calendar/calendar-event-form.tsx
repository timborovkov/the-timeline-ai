'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { createCalendarEventAction } from '@/app/actions/calendar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export function CreateCalendarEventForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);

    const fd = new FormData(e.currentTarget);
    const title = fd.get('title') as string;
    const description = fd.get('description') as string;
    const startAt = fd.get('startAt') as string;
    const endAt = fd.get('endAt') as string;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const location = fd.get('location') as string;
    const allDay = fd.get('allDay') === 'on';
    const visibility = (fd.get('visibility') as string) || 'team';

    if (!title || !startAt || !endAt) {
      setError('Title, start, and end are required.');
      setPending(false);
      return;
    }

    const result = await createCalendarEventAction({
      title,
      description: description || undefined,
      startAt: new Date(startAt).toISOString(),
      endAt: new Date(endAt).toISOString(),
      timezone,
      allDay,
      location: location || undefined,
      visibility: visibility as 'team' | 'private' | 'specific_users',
    });

    setPending(false);
    if (!result.ok) {
      setError(result.error ?? 'Failed to create event');
      return;
    }
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-lg border p-4">
      <div className="space-y-2">
        <Label htmlFor="title">Title</Label>
        <Input id="title" name="title" placeholder="Team standup" required maxLength={200} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="startAt">Start</Label>
          <Input id="startAt" name="startAt" type="datetime-local" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="endAt">End</Label>
          <Input id="endAt" name="endAt" type="datetime-local" required />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="location">Location</Label>
        <Input id="location" name="location" placeholder="Office / Zoom link" maxLength={500} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          name="description"
          placeholder="Optional notes..."
          maxLength={2000}
          rows={2}
        />
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <input id="allDay" name="allDay" type="checkbox" className="rounded border" />
          <Label htmlFor="allDay" className="text-sm">
            All day
          </Label>
        </div>
        <div className="space-y-1">
          <Label htmlFor="visibility" className="text-sm">
            Visibility
          </Label>
          <select
            id="visibility"
            name="visibility"
            defaultValue="team"
            className="rounded border bg-background px-2 py-1 text-sm"
          >
            <option value="team">Team</option>
            <option value="private">Private</option>
          </select>
        </div>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Button type="submit" disabled={pending}>
        {pending ? 'Creating...' : 'Create Event'}
      </Button>
    </form>
  );
}
