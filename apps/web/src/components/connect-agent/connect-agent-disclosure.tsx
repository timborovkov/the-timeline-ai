'use client';

import { ChevronRight } from 'lucide-react';
import { useLayoutEffect, useRef, type ReactNode } from 'react';

export function ConnectAgentDisclosure({
  title,
  children,
  defaultOpen = false,
}: {
  title: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useLayoutEffect(() => {
    if (defaultOpen && detailsRef.current) detailsRef.current.open = true;
  }, [defaultOpen]);

  return (
    <details ref={detailsRef} className="group py-4">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-fg marker:content-none [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden="true"
          className="size-3.5 shrink-0 text-fg-dim transition-transform group-open:rotate-90 motion-reduce:transition-none"
        />
        {title}
      </summary>
      <div className="mt-4 space-y-4">{children}</div>
    </details>
  );
}
