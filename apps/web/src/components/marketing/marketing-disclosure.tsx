import { ChevronDown } from 'lucide-react';

import type { ReactNode } from 'react';

export function MarketingDisclosure({
  summary,
  children,
}: {
  summary: string;
  children: ReactNode;
}) {
  return (
    <details className="group mt-6 min-w-0 border-y border-border">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 rounded-sm py-4 font-medium text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden">
        {summary}
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 group-open:rotate-180" />
      </summary>
      <div className="space-y-4 pb-6 text-base leading-7 text-fg-muted [overflow-wrap:anywhere] [&_p]:max-w-[70ch]">
        {children}
      </div>
    </details>
  );
}
