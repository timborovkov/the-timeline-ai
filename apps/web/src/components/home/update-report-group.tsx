import {
  digestAppHref,
  updateSectionLabel,
  type UpdateReportGroup,
} from '@timeline/shared/messaging/format';
import { CalendarDays, CheckCircle2, ListFilter, Radio } from 'lucide-react';
import Link from 'next/link';

const icons = {
  activity: Radio,
  due: CheckCircle2,
  calendar: CalendarDays,
  savedViews: ListFilter,
};

export function UpdateReportGroupList({ group }: { group: UpdateReportGroup }) {
  const Icon = icons[group.section];
  return (
    <section className="min-w-0">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-fg">
        <Icon className="size-4 shrink-0 text-fg-muted" aria-hidden="true" />
        {updateSectionLabel(group.section)}
      </h3>
      <ul className="mt-2 divide-y divide-border">
        {group.items.map((item) => {
          const links = item.links.flatMap((link) => {
            const href = digestAppHref(link.href);
            return href ? [{ ...link, href }] : [];
          });
          const primary = links[0];
          return (
            <li key={primary?.href ?? item.title} className="py-3">
              {group.section === 'activity' || !primary ? (
                <p className="text-base leading-snug font-medium text-fg break-words">
                  {item.title}
                </p>
              ) : (
                <Link
                  href={primary.href}
                  className="text-sm leading-snug font-medium text-fg underline decoration-border-strong underline-offset-4 hover:decoration-signal"
                >
                  {item.title}
                </Link>
              )}
              {item.detail && (
                <p className="mt-1 text-sm leading-relaxed text-fg-muted break-words">
                  {item.detail}
                </p>
              )}
              {group.section === 'activity' && links.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-2">
                  {links.map((link, index) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      aria-label={`Open ${link.label} evidence ${String(index + 1)} for ${item.title}`}
                      className="text-xs font-medium text-fg-muted underline decoration-border-strong underline-offset-4 hover:text-fg hover:decoration-signal"
                    >
                      {link.label}
                      {links.filter((source) => source.label === link.label).length > 1
                        ? ` ${String(index + 1)}`
                        : ''}
                    </Link>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
