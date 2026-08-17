import {
  digestActivityStats,
  digestAppHref,
  digestContentSections,
  digestSectionBody,
  digestSummaryParagraphs,
  formatDigestActivityLines,
  formatDigestCalendarEventDetail,
  formatDigestDate,
  formatDigestObjectType,
  formatDigestTaskDetail,
  formatDigestWindowRange,
  type DailyDigestPayload,
} from '@timeline/shared/messaging/format';
import { CalendarDays, CircleDot, Shapes, UserRound } from 'lucide-react';
import Link from 'next/link';

import type { ReactNode } from 'react';

import { CollectionRow } from '@/components/collections/collection-row';
import { displayMemberLabel } from '@/lib/display-labels';
import { cn } from '@/lib/utils';

export function DigestBody({
  digest,
  className,
}: {
  digest: DailyDigestPayload;
  className?: string;
}) {
  const summary = digestSummaryParagraphs(digest.summary);
  const sections = digestContentSections(digest);
  const activity = digestActivityStats(digest);
  const activityLines = formatDigestActivityLines(activity);
  const completedTasks = digest.completedTasks ?? [];
  const newObjects = digest.newObjects ?? [];
  const windowCalendar = digest.windowCalendar ?? [];
  const memberItems = digest.newTeamMembers.map((member) => ({
    key: member.userId,
    label: displayMemberLabel({ name: member.label }),
    detail: `Joined ${formatDigestDate(member.createdAt, digest.timezone)}`,
  }));
  const dashboardLinks: { label: string; href: string }[] = [];
  for (const link of digest.links) {
    const href = digestAppHref(link.href);
    if (href) dashboardLinks.push({ label: link.label, href });
  }
  const windowRange = formatDigestWindowRange(
    digest.windowStart,
    digest.windowEnd,
    digest.timezone,
  );

  return (
    <div className={cn('space-y-8 text-sm', className)}>
      <p className="font-mono text-[11px] leading-4 text-fg-dim">Covering {windowRange}</p>

      <div className="max-w-3xl space-y-3">
        {summary.map((paragraph, index) => (
          <p key={`${paragraph}:${String(index)}`} className="text-[15px] leading-7 text-fg">
            {paragraph}
          </p>
        ))}
      </div>

      {sections.length > 0 ? (
        <div className="grid gap-0 border-t border-border md:grid-cols-2 md:gap-x-8">
          {sections.map((section) => (
            <section key={section.title} className="min-w-0 border-b border-border py-4">
              <h3 className="text-xs font-medium text-fg-dim">{section.title}</h3>
              {section.body ? (
                <p className="mt-2 leading-6 text-fg">{digestSectionBody(section)}</p>
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
      ) : null}

      {activityLines.length > 0 ? (
        <section>
          <h3 className="text-xs font-medium text-fg-dim">Activity</h3>
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-fg-muted">
            {activityLines.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </p>
        </section>
      ) : null}

      <div className="space-y-6">
        <DigestList
          label="New tasks"
          icon={<CircleDot className="size-3.5" />}
          items={digest.tasks.map((task) => ({
            key: task.id,
            href: digestAppHref(task.href) ?? undefined,
            label: task.title,
            detail: formatDigestTaskDetail(task, digest.timezone),
          }))}
        />
        <DigestList
          label="Completed tasks"
          icon={<CircleDot className="size-3.5" />}
          items={completedTasks.map((task) => ({
            key: task.id,
            href: digestAppHref(task.href) ?? undefined,
            label: task.title,
            detail: formatDigestTaskDetail(task, digest.timezone),
          }))}
        />
        <DigestList
          label="New objects"
          icon={<Shapes className="size-3.5" />}
          items={newObjects.map((object) => ({
            key: object.id,
            href: digestAppHref(object.href) ?? undefined,
            label: object.title,
            detail: formatDigestObjectType(object.type),
          }))}
        />
        <DigestList
          label="Calendar this window"
          icon={<CalendarDays className="size-3.5" />}
          items={windowCalendar.map((event) => ({
            key: event.id,
            href: digestAppHref(event.href) ?? undefined,
            label: event.title,
            detail: formatDigestCalendarEventDetail(event, digest.timezone),
          }))}
        />
        <DigestList
          label="Upcoming calendar"
          icon={<CalendarDays className="size-3.5" />}
          items={digest.upcomingCalendar.map((event) => ({
            key: event.id,
            href: digestAppHref(event.href) ?? undefined,
            label: event.title,
            detail: formatDigestCalendarEventDetail(event, digest.timezone),
          }))}
        />
        <DigestList
          label="New team members"
          icon={<UserRound className="size-3.5" />}
          items={memberItems}
        />
      </div>

      {dashboardLinks.length > 0 ? (
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-muted">
          {dashboardLinks.map((link) => (
            <Link key={link.href} href={link.href} className="hover:text-fg">
              {link.label}
            </Link>
          ))}
        </p>
      ) : null}

      <p className="font-mono text-[11px] leading-4 text-fg-dim">
        Window {windowRange}. Built from timeline activity in this period.
      </p>
    </div>
  );
}

function DigestList({
  label,
  icon,
  items,
}: {
  label: string;
  icon: ReactNode;
  items: { key: string; label: string; href?: string; detail?: string }[];
}) {
  if (items.length === 0) return null;
  return (
    <section>
      <h3 className="mb-1 text-xs font-medium text-fg-dim">{label}</h3>
      <div className="border-y border-border">
        {items.map((item) => (
          <CollectionRow
            key={item.key}
            leading={
              <span className="flex size-7 items-center justify-center text-fg-muted">{icon}</span>
            }
            title={
              item.href ? (
                <Link
                  href={item.href}
                  className="underline decoration-border underline-offset-4 transition-colors hover:text-signal hover:decoration-signal"
                >
                  {item.label}
                </Link>
              ) : (
                item.label
              )
            }
            metadata={
              item.detail ? (
                <span className="font-mono text-[11px] text-fg-dim">
                  {item.detail.replace(/^\(|\)$/g, '')}
                </span>
              ) : undefined
            }
          />
        ))}
      </div>
    </section>
  );
}
