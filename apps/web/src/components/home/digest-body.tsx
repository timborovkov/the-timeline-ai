import {
  digestActivityStats,
  digestAppHref,
  digestContentSections,
  digestSectionBody,
  digestSummaryParagraphs,
  formatDigestActivityItems,
  formatDigestObjectType,
  updateCoveringRange,
  type DailyDigestPayload,
} from '@timeline/shared/messaging/format';
import { localDateFromInstant } from '@timeline/shared/time';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { DigestTaskDetail } from '@/components/home/digest-task-detail';
import { UpdateReportGroupList } from '@/components/home/update-report-group';
import { RegionalDate } from '@/components/regional-date';
import { RegionalNumber } from '@/components/regional-number';
import { parseDisplayDate } from '@/lib/display-dates';
import { displayMemberLabel } from '@/lib/display-labels';
import { cn } from '@/lib/utils';

const rangeStartParts = {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
} as const;

const rangeEndParts = { ...rangeStartParts, year: 'numeric', timeZoneName: 'short' } as const;

export function DigestBody({
  digest,
  className,
}: {
  digest: DailyDigestPayload;
  className?: string;
}) {
  if (digest.update) {
    return (
      <div className={cn('space-y-4', className)}>
        {digest.update.groups.length === 0 && (
          <p className="text-sm text-fg-muted">No sources are currently visible.</p>
        )}
        {digest.update.groups.map((group) => (
          <UpdateReportGroupList key={group.section} group={group} />
        ))}
        <p className="font-mono text-xs text-fg-dim">Covering {updateCoveringRange(digest)}</p>
      </div>
    );
  }
  const summary = digestSummaryParagraphs(digest.summary);
  const sections = digestContentSections(digest);
  const activityItems = formatDigestActivityItems(digestActivityStats(digest));
  const completedTasks = digest.completedTasks ?? [];
  const dueStatusAt = new Date();
  const newObjects = digest.newObjects ?? [];
  const windowCalendar = digest.windowCalendar ?? [];
  const memberItems = digest.newTeamMembers.map((member) => ({
    key: member.userId,
    label: (
      <>
        {displayMemberLabel({ name: member.label })} · Joined{' '}
        <RegionalDate value={member.createdAt} />
      </>
    ),
  }));
  const dashboardLinks: { label: string; href: string }[] = [];
  for (const link of digest.links) {
    const href = digestAppHref(link.href);
    if (href) dashboardLinks.push({ label: link.label, href });
  }

  return (
    <div className={cn('@container space-y-6 text-sm', className)}>
      <div className="max-w-3xl space-y-5">
        {summary.map((paragraph, index) => (
          <p key={`${paragraph}:${String(index)}`} className="leading-6 text-fg">
            {paragraph}
          </p>
        ))}
        {sections.map((section) => (
          <section key={section.title}>
            <h3 className="font-semibold text-fg">{section.title}</h3>
            {section.body ? (
              <p className="mt-2 leading-6 text-fg-muted">{digestSectionBody(section)}</p>
            ) : (
              <ul className="mt-2 space-y-1 text-fg-muted">
                {section.items.map((item, index) => (
                  <li key={`${item}:${String(index)}`}>{item}</li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      {activityItems.length > 0 ? (
        <section aria-label="Activity" className="py-3">
          <p className="flex flex-wrap gap-x-5 gap-y-1 font-mono text-xs text-fg-muted">
            {activityItems.map((item) => (
              <span key={item.label}>
                <span className="text-signal">
                  <RegionalNumber value={item.count} />
                </span>{' '}
                {item.label}
              </span>
            ))}
          </p>
        </section>
      ) : null}

      <div className="grid gap-6 @lg:grid-cols-2">
        <DigestList
          label="New tasks"
          items={digest.tasks.map((task) => ({
            key: task.id,
            href: digestAppHref(task.href) ?? undefined,
            label: task.title,
            detail: <DigestTaskDetail task={task} timezone={digest.timezone} now={dueStatusAt} />,
          }))}
        />
        <DigestList
          label="Completed tasks"
          items={completedTasks.map((task) => ({
            key: task.id,
            href: digestAppHref(task.href) ?? undefined,
            label: task.title,
            detail: <DigestTaskDetail task={task} timezone={digest.timezone} now={dueStatusAt} />,
          }))}
        />
        <DigestList
          label="New objects"
          items={newObjects.map((object) => ({
            key: object.id,
            href: digestAppHref(object.href) ?? undefined,
            label: object.title,
            detail: `(${formatDigestObjectType(object.type)})`,
          }))}
        />
        <DigestList
          label="Calendar this window"
          items={digestCalendarItems(windowCalendar, digest.timezone)}
        />
        <DigestList
          label="Upcoming calendar"
          items={digestCalendarItems(digest.upcomingCalendar, digest.timezone)}
        />
        <DigestList label="New team members" items={memberItems} />
      </div>

      {dashboardLinks.length > 0 ? (
        <p className="text-xs text-fg-muted">
          {dashboardLinks.map((link, index) => (
            <span key={link.href}>
              {index > 0 ? ' · ' : null}
              <Link href={link.href} className="hover:text-fg">
                {link.label}
              </Link>
            </span>
          ))}
        </p>
      ) : null}

      <p className="font-mono text-xs text-fg-dim">
        Covering <RegionalDate value={digest.windowStart} parts={rangeStartParts} />
        {' – '}
        <RegionalDate value={digest.windowEnd} parts={rangeEndParts} />
      </p>
    </div>
  );
}

function digestCalendarItems(
  events: DailyDigestPayload['upcomingCalendar'],
  digestTimezone = 'UTC',
) {
  return events.map((event) => {
    const allDay = 'allDay' in event ? event.allDay : undefined;
    const eventTimezone =
      'eventTimezone' in event && typeof event.eventTimezone === 'string'
        ? event.eventTimezone
        : digestTimezone;
    const start = parseDisplayDate(event.startAt);
    const day =
      allDay === true && start
        ? localDateFromInstant(start.toISOString(), eventTimezone)
        : undefined;
    return {
      key: event.id,
      href: digestAppHref(event.href) ?? undefined,
      label: event.title,
      detail: (
        <>
          ({event.repeating ? 'repeating · next ' : null}
          {day ? (
            <RegionalDate value={day} />
          ) : (
            <RegionalDate
              value={event.startAt}
              parts={rangeEndParts}
              timezone={allDay === false ? undefined : digestTimezone}
            />
          )}
          )
        </>
      ),
    };
  });
}

// react-doctor-disable-next-line react-doctor/no-multi-comp -- Digest linked lists share the briefing payload renderer.
function DigestList({
  label,
  items,
}: {
  label: string;
  items: { key: string; label: ReactNode; href?: string; detail?: ReactNode }[];
}) {
  if (items.length === 0) return null;
  return (
    <section>
      <h3 className="font-semibold text-fg">{label}</h3>
      <ul className="mt-2 space-y-1 text-fg-muted">
        {items.map((item) => (
          <li key={item.key}>
            {item.href ? (
              <Link
                href={item.href}
                className="text-fg underline decoration-border underline-offset-4 transition-colors hover:text-signal hover:decoration-signal"
              >
                {item.label}
              </Link>
            ) : (
              item.label
            )}
            {item.detail ? <> {item.detail}</> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
