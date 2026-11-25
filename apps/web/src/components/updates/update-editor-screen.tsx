import type { DigestDestinationKind } from '@timeline/shared/messaging';
import {
  DEFAULT_UPDATE_SETTINGS,
  type UpdateSchedule,
  type UpdateSettings,
} from '@timeline/shared/messaging/format';
import Link from 'next/link';

import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { UpdateEditor } from '@/components/updates/update-editor';

const presets: Record<'daily' | 'weekly', UpdateSettings> = {
  daily: {
    ...DEFAULT_UPDATE_SETTINGS,
    name: 'Daily check-in',
    includeContent: true,
    time: '09:00',
    channel: 'telegram',
    upcomingDays: 3,
    sections: ['activity', 'due'],
  },
  weekly: {
    ...DEFAULT_UPDATE_SETTINGS,
    name: 'Weekly recap',
    includeContent: true,
    cadence: 'weekly',
    time: '09:00',
    channel: 'email',
    detail: 'detailed',
    lookbackDays: 7,
    sections: ['activity', 'due', 'calendar'],
  },
};

const headings = {
  workspace: ['Workspace default', 'Members inherit this schedule until they customize their own.'],
  new: ['New update', 'Start with a preset and adjust what it covers and when it arrives.'],
  personal: ['Edit update', 'Changes apply to your deliveries in this workspace.'],
} as const;

export function UpdateEditorScreen({
  teamId,
  timezone,
  personalDestinations,
  mode,
  preset,
  schedule,
}: {
  teamId: string;
  timezone: string;
  personalDestinations: DigestDestinationKind[];
  mode: keyof typeof headings;
  preset: keyof typeof presets;
  schedule?: Pick<UpdateSchedule, 'key' | 'inherited' | 'settings'>;
}) {
  const [title, subtitle] = headings[mode];
  const creating = mode === 'new';
  const initial = schedule?.settings ?? presets[preset];
  const scheduleKey = schedule?.key ?? crypto.randomUUID();
  return (
    <div data-app-width="collection" className="max-w-4xl space-y-5">
      <Link
        href="/app/updates"
        className="text-sm text-fg-muted underline underline-offset-4 hover:text-fg"
      >
        All schedules
      </Link>
      <PageHeader title={title} subtitle={subtitle} />
      {creating && (
        <nav aria-label="Update presets" className="flex flex-wrap gap-2">
          <Button asChild variant={preset !== 'weekly' ? 'secondary' : 'outline'}>
            <Link
              href="/app/updates?edit=new&preset=daily"
              aria-current={preset !== 'weekly' ? 'true' : undefined}
            >
              Daily check-in
            </Link>
          </Button>
          <Button asChild variant={preset === 'weekly' ? 'secondary' : 'outline'}>
            <Link
              href="/app/updates?edit=new&preset=weekly"
              aria-current={preset === 'weekly' ? 'true' : undefined}
            >
              Weekly recap
            </Link>
          </Button>
        </nav>
      )}
      <UpdateEditor
        key={`${teamId}/${mode}/${schedule?.key ?? 'new'}/${preset}`}
        teamId={teamId}
        scheduleKey={scheduleKey}
        creating={creating}
        initial={initial}
        timezone={timezone}
        personalDestinations={personalDestinations}
        workspace={mode === 'workspace'}
        inherited={schedule?.inherited ?? false}
      />
    </div>
  );
}
