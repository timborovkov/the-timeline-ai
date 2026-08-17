import {
  digestActivityStats,
  digestAppHref,
  digestContentSections,
  digestSectionBody,
  digestSummaryParagraphs,
  formatDigestActivityLines,
  formatDigestCalendarEventDetail,
  formatDigestDate,
  formatDigestTaskDetail,
  type DailyDigestPayload,
} from '@timeline/shared/messaging/format';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { displayMemberLabel, displaySourceLabel } from '@/lib/display-labels';
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
  const sourceItems = Object.entries(digest.sourceDistribution).map(
    ([source, count]) => `${displaySourceLabel(source)} · ${String(count)}`,
  );
  const memberItems = digest.newTeamMembers.map(
    (member) =>
      `${displayMemberLabel({ name: member.label })} · Joined ${formatDigestDate(
        member.createdAt,
        digest.timezone,
      )}`,
  );
  const dashboardLinks: { label: string; href: string }[] = [];
  for (const link of digest.links) {
    const href = digestAppHref(link.href);
    if (href) dashboardLinks.push({ label: link.label, href });
  }

  return (
    <div className={cn('space-y-6 text-sm', className)}>
      <div className="max-w-3xl space-y-3">
        {summary.map((paragraph, index) => (
          <p key={`${paragraph}:${String(index)}`} className="leading-6 text-fg">
            {paragraph}
          </p>
        ))}
      </div>

      {sections.length > 0 ? (
        <div className="grid gap-6 md:grid-cols-2">
          {sections.map((section) => (
            <section key={section.title} className="min-w-0">
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
      ) : null}

      <section>
        <h3 className="font-semibold text-fg">Activity over the past day</h3>
        <p className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-fg-muted">
          {activityLines.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </p>
      </section>

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
          label="Upcoming calendar"
          items={digest.upcomingCalendar.map((event) => ({
            key: event.id,
            href: digestAppHref(event.href) ?? undefined,
            label: event.title,
            detail: formatDigestCalendarEventDetail(event, digest.timezone),
          }))}
        />
        <DigestList
          label="Sources in this window"
          items={sourceItems.map((item) => ({ key: item, label: item }))}
        />
        <DigestList
          label="New team members"
          items={memberItems.map((item) => ({ key: item, label: item }))}
        />
      </div>

      {dashboardLinks.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {dashboardLinks.map((link) => (
            <Button key={link.href} asChild variant="outline" size="sm">
              <Link href={link.href}>{link.label}</Link>
            </Button>
          ))}
        </div>
      ) : null}
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
              <Link href={item.href} className="text-fg hover:text-signal">
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
