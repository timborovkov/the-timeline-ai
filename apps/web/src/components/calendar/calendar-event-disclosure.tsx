import { ChevronDown, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export function CalendarEventDisclosure({
  icon: Icon,
  label,
  value,
  onToggle,
  children,
}: {
  icon: LucideIcon;
  label: string;
  value?: string;
  onToggle?: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <details
      className="group/disclosure"
      onToggle={(event) => {
        onToggle?.(event.currentTarget.open);
      }}
    >
      <summary
        aria-description={value}
        className="flex min-h-11 cursor-pointer list-none items-center gap-2.5 px-3 py-2 text-sm font-medium hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:px-4 [&::-webkit-details-marker]:hidden"
      >
        <Icon aria-hidden="true" className="size-4 shrink-0 text-fg-muted" />
        <span className="min-w-0 flex-1">{label}</span>
        {value && (
          <span
            className="max-w-[42%] truncate text-xs font-normal text-fg-muted"
            aria-hidden="true"
          >
            {value}
          </span>
        )}
        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0 text-fg-muted group-open/disclosure:rotate-180"
        />
      </summary>
      <div className="space-y-3 px-3 pt-1 pb-4 sm:px-4">{children}</div>
    </details>
  );
}
