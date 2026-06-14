import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

import { cn } from '@/lib/utils';

function WorkBackLink({ className }: { className?: string }) {
  return (
    <Link
      href="/app/work"
      className={cn(
        'inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em]',
        'text-fg-muted hover:text-fg hover:underline',
        className,
      )}
    >
      <ArrowLeft className="size-3.5" aria-hidden="true" />
      Back
    </Link>
  );
}

export const WORK_BACK_LINK = <WorkBackLink />;
