import Link from 'next/link';

import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

export interface HubMetric {
  label: string;
  value: string | number;
  tone?: 'neutral' | 'signal' | 'danger';
}

interface HubStatusCardProps {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
  metrics: readonly HubMetric[];
  action?: string;
}

export function HubStatusCard({
  href,
  label,
  description,
  icon: Icon,
  metrics,
  action = 'open',
}: HubStatusCardProps) {
  return (
    <Link
      href={href}
      className="group flex min-h-36 flex-col justify-between bg-bg p-4 transition-colors hover:bg-surface"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg">{label}</h2>
          <p className="mt-2 max-w-sm text-sm leading-6 text-fg-muted">{description}</p>
        </div>
        <Icon
          aria-hidden="true"
          className="size-4 shrink-0 text-fg-dim transition-colors group-hover:text-signal"
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {metrics.map((metric) => (
            <span
              key={metric.label}
              className={cn(
                'inline-flex min-h-7 items-center rounded-sm border px-2 font-mono text-[10px] uppercase tracking-[0.12em]',
                metric.tone === 'danger'
                  ? 'border-danger/40 text-danger'
                  : metric.tone === 'signal'
                    ? 'border-signal/40 bg-signal-soft text-signal'
                    : 'border-border text-fg-muted',
              )}
            >
              {metric.label} · {metric.value}
            </span>
          ))}
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-signal">
          {action} →
        </span>
      </div>
    </Link>
  );
}
