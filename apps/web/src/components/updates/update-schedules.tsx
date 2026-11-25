import {
  UPDATE_CHANNELS,
  UPDATE_WEEKDAYS,
  type UpdateSchedule,
  type UpdateSettings,
} from '@timeline/shared/messaging/format';
import { CalendarClock, History, Mail, MessageCircle, Plus, Send, Settings2 } from 'lucide-react';
import Link from 'next/link';

import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';

function describeSchedule(settings: UpdateSettings) {
  const timing =
    settings.cadence === 'daily' ? 'Every day' : `Every ${UPDATE_WEEKDAYS[settings.weekday - 1]}`;
  const channel = UPDATE_CHANNELS.find((option) => option.value === settings.channel)?.label;
  return [
    `${timing} at ${settings.time}`,
    channel,
    settings.detail === 'brief' ? 'Quick scan' : 'More context',
  ].join(' · ');
}

const channelIcons = {
  workspace: Send,
  email: Mail,
  telegram: MessageCircle,
  slack: MessageCircle,
};

// react-doctor-disable-next-line react-doctor/no-multi-comp -- A server-rendered schedule row shares its page's form route.
function ScheduleRow({ schedule }: { schedule: UpdateSchedule }) {
  const Icon = channelIcons[schedule.settings.channel];
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-4">
      <span
        className="grid size-9 shrink-0 place-items-center rounded-sm border border-border bg-bg"
        aria-hidden="true"
      >
        <Icon className="size-4 text-fg-muted" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <h3 className="font-medium text-fg [overflow-wrap:anywhere]">{schedule.settings.name}</h3>
          {!schedule.settings.enabled && <span className="text-xs text-fg-muted">Paused</span>}
          {schedule.inherited && <span className="text-xs text-fg-muted">Workspace default</span>}
        </div>
        <p className="mt-0.5 text-sm text-fg-muted">{describeSchedule(schedule.settings)}</p>
      </div>
      <Button asChild variant="outline" size="sm">
        <Link
          href={`/app/updates?edit=${encodeURIComponent(schedule.key)}`}
          aria-label={`Edit ${schedule.settings.name}`}
        >
          Edit
        </Link>
      </Button>
    </li>
  );
}

export function UpdateSchedules({
  schedules,
  workspaceDefault,
  hasLegacySchedule,
  timezone,
}: {
  schedules: UpdateSchedule[];
  workspaceDefault: UpdateSettings | undefined;
  hasLegacySchedule: boolean;
  timezone: string;
}) {
  return (
    <div data-app-width="collection" className="max-w-4xl space-y-6">
      <PageHeader
        title="Updates"
        subtitle="Choose what lands in your inbox or DMs, and when."
        trailing={
          <Button asChild variant="outline">
            <Link href="/app/digests">
              <History aria-hidden="true" />
              Update history
            </Link>
          </Button>
        }
      />
      <section
        aria-labelledby="personal-updates-heading"
        className="overflow-hidden rounded-md border border-border bg-surface"
      >
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface-2 px-4 py-4 sm:px-5">
          <div className="flex items-start gap-3">
            <CalendarClock className="mt-0.5 size-5 shrink-0 text-signal" aria-hidden="true" />
            <div>
              <h2 id="personal-updates-heading" className="font-semibold text-fg">
                Your schedules
              </h2>
              <p className="mt-0.5 text-sm text-fg-muted">
                Send times use {timezone.replaceAll('_', ' ')}.
              </p>
            </div>
          </div>
          <Button asChild>
            <Link href="/app/updates?edit=new">
              <Plus aria-hidden="true" />
              New update
            </Link>
          </Button>
        </header>
        <ul className="divide-y divide-border px-4 sm:px-5">
          {hasLegacySchedule && (
            <li className="flex flex-wrap items-center justify-between gap-3 py-4">
              <h3 className="font-medium text-fg">Previous schedule</h3>
              <Button asChild variant="outline" size="sm">
                <Link href="/app/updates?legacy=1">Edit previous schedule</Link>
              </Button>
            </li>
          )}
          {schedules.map((schedule) => (
            <ScheduleRow key={schedule.key} schedule={schedule} />
          ))}
        </ul>
      </section>
      {workspaceDefault && (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-4 py-4 sm:px-5">
          <div>
            <h2 className="flex items-center gap-2 font-semibold text-fg">
              <Settings2 aria-hidden="true" className="size-4 text-fg-muted" />
              Workspace default
            </h2>
            <p className="mt-1 text-sm text-fg-muted">
              {describeSchedule(workspaceDefault)}
              {!workspaceDefault.enabled ? ' · Paused' : ''}
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/app/updates?edit=workspace">Edit default</Link>
          </Button>
        </section>
      )}
    </div>
  );
}
