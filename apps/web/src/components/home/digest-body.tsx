import {
  digestActivityStats,
  digestAppHref,
  digestContentSections,
  digestSectionBody,
  digestSummaryParagraphs,
  formatDigestActivityItems,
  formatDigestCalendarEventDetail,
  formatDigestDate,
  formatDigestObjectType,
  formatDigestTaskDetail,
  formatDigestWindowRange,
  type DailyDigestPayload,
} from '@timeline/shared/messaging/format';
import Link from 'next/link';

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
  const activityItems = formatDigestActivityItems(digestActivityStats(digest));
  const completedTasks = digest.completedTasks ?? [];
  const newObjects = digest.newObjects ?? [];
  const windowCalendar = digest.windowCalendar ?? [];
  const memberItems = digest.newTeamMembers.map((member) => ({
    key: member.userId,
    label: `${displayMemberLabel({ name: member.label })} · Joined ${formatDigestDate(
      member.createdAt,
      digest.timezone,
    )}`,
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
    <div className={cn('space-y-6 text-sm', className)}>
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
        <section aria-label="Activity" className="border-y border-border py-3">
          <p className="flex flex-wrap gap-x-5 gap-y-1 font-mono text-xs text-fg-muted">
            {activityItems.map((item) => (
              <span key={item.label}>
                <span className="text-signal">{item.count}</span> {item.label}
              </span>
            ))}
          </p>
        </section>
      ) : null}

      <div className="grid gap-6 md:grid-cols-2">
        <DigestList
          label="New tasks"
          items={digest.tasks.map((task) => ({
            key: task.id,
            href: digestAppHref(task.href) ?? undefined,
            label: task.title,
            detail: formatDigestTaskDetail(task, digest.timezone),
          }))}
        />
        <DigestList
          label="Completed tasks"
          items={completedTasks.map((task) => ({
            key: task.id,
            href: digestAppHref(task.href) ?? undefined,
            label: task.title,
            detail: formatDigestTaskDetail(task, digest.timezone),
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
          items={windowCalendar.map((event) => ({
            key: event.id,
            href: digestAppHref(event.href) ?? undefined,
            label: event.title,
            detail: formatDigestCalendarEventDetail(event, digest.timezone),
          }))}
        />
        <DigestList
          label="Upcoming calendar"
          items={digest.upcomingCalendar.map((event) => ({
            key: event.id,
            href: digestAppHref(event.href) ?? undefined,
            label: event.title,
            detail: formatDigestCalendarEventDetail(event, digest.timezone),
          }))}
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

      <p className="font-mono text-xs text-fg-dim">Covering {windowRange}</p>
    </div>
  );
}

function DigestList({
  label,
  items,
}: {
  label: string;
  items: { key: string; label: string; href?: string; detail?: string }[];
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
            {item.detail ? ` ${item.detail}` : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
