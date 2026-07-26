import {
  digestContentSections,
  digestSummaryParagraphs,
  formatDigestCalendarEvent,
  formatDigestDate,
  formatDigestTask,
  type DailyDigestPayload,
} from '@timeline/shared/messaging';
import Link from 'next/link';

import { SectionHeading } from '@/components/section-heading';
import { Button } from '@/components/ui/button';
import { displayMemberLabel, displaySourceLabel } from '@/lib/display-labels';

export function DailyDigestBlock({ digest }: { digest: DailyDigestPayload | undefined }) {
  if (!digest?.summary) return null;
  const summary = digestSummaryParagraphs(digest.summary);
  const sections = digestContentSections(digest);
  const keyItems = sections.flatMap((section) => section.items).slice(0, 3);

  return (
    <section
      aria-labelledby="latest-digest-heading"
      className="space-y-3 border-y border-border py-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <SectionHeading id="latest-digest-heading">Latest digest</SectionHeading>
        <time className="font-mono text-xs text-fg-dim">
          {formatDigestDate(digest.windowEnd, digest.timezone)}
        </time>
      </div>
      <p className="max-w-3xl text-sm leading-6 text-fg-muted">{summary[0]}</p>
      {keyItems.length > 0 ? (
        <ul className="space-y-1 text-sm text-fg">
          {keyItems.map((item, index) => (
            <li key={`${item}:${index}`}>• {item}</li>
          ))}
        </ul>
      ) : null}
      <details className="border-t border-border pt-3 text-sm">
        <summary className="cursor-pointer font-medium text-fg-muted hover:text-fg">
          Complete digest
        </summary>
        <div className="mt-3 grid gap-5 md:grid-cols-2">
          {summary.slice(1).map((paragraph, index) => (
            <p key={`${paragraph}:${index}`} className="text-fg-muted">
              {paragraph}
            </p>
          ))}
          {sections.map((section) => (
            <div key={section.title}>
              <h3 className="font-semibold text-fg">{section.title}</h3>
              <ul className="mt-2 space-y-1 text-fg-muted">
                {section.items.map((item, index) => (
                  <li key={`${item}:${index}`}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
          <div className="md:col-span-2">
            <h3 className="font-semibold text-fg">Activity</h3>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-fg-muted">
              {digest.momentCount === undefined ? (
                <DigestStat count={digest.eventCount} label="event" />
              ) : (
                <DigestStat count={digest.momentCount} label="moment" />
              )}
              <DigestStat count={digest.pendingApprovals} label="approval" />
            </div>
          </div>
          <DigestList
            label="Sources"
            items={Object.entries(digest.sourceDistribution).map(
              ([source, count]) => `${displaySourceLabel(source)} · ${String(count)}`,
            )}
          />
          <DigestList
            label="Objects"
            items={Object.entries(digest.objectChangesByType).map(
              ([type, count]) => `${sentenceLabel(type)} · ${String(count)}`,
            )}
          />
          <DigestList
            label="New team members"
            items={digest.newTeamMembers.map(
              (member) =>
                `${displayMemberLabel({ name: member.label })} · Joined ${formatDigestDate(
                  member.createdAt,
                  digest.timezone,
                )}`,
            )}
          />
          <DigestList
            label="Current tasks"
            items={digest.tasks.map((task) => formatDigestTask(task, digest.timezone))}
          />
          <DigestList
            label="Upcoming calendar"
            items={digest.upcomingCalendar.map((event) =>
              formatDigestCalendarEvent(event, digest.timezone),
            )}
          />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {digest.links.map((link) => (
            <Button key={link.href} asChild variant="outline" size="sm">
              <Link href={link.href}>{link.label}</Link>
            </Button>
          ))}
        </div>
      </details>
    </section>
  );
}

function DigestStat({ count, label }: { count: number; label: string }) {
  return (
    <span>
      <strong className="font-mono font-medium text-fg">{String(count)}</strong>{' '}
      {count === 1 ? label : `${label}s`}
    </span>
  );
}

function sentenceLabel(value: string): string {
  const normalized = value.trim().replaceAll('_', ' ').toLowerCase();
  return normalized.replace(/^\w/, (letter) => letter.toUpperCase());
}

function DigestList({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="font-semibold text-fg">{label}</h3>
      <ul className="mt-2 space-y-1 text-fg-muted">
        {items.map((item, index) => (
          <li key={`${item}:${index}`}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
