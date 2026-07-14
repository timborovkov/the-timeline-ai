'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import type { MouseEvent } from 'react';

import { shouldUseHistoryBackClick } from '@/lib/history-back';
import { cn } from '@/lib/utils';

interface HistoryBackLinkProps {
  fallbackHref: string;
  label: string;
  className?: string;
}

export function HistoryBackLink({ fallbackHref, label, className }: HistoryBackLinkProps) {
  const router = useRouter();

  function navigateBack(event: MouseEvent<HTMLAnchorElement>): void {
    if (!shouldUseHistoryBackClick(event)) return;
    event.preventDefault();
    router.back();
  }

  return (
    <Link
      href={fallbackHref}
      onClick={navigateBack}
      className={cn(
        'inline-flex min-h-8 items-center gap-1.5 text-xs',
        'text-fg-muted hover:text-fg hover:underline',
        className,
      )}
    >
      <ArrowLeft className="size-3.5" aria-hidden="true" />
      {label}
    </Link>
  );
}
