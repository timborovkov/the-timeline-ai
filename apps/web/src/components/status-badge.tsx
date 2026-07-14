import { Badge } from '@/components/ui/badge';
import { statusLabel } from '@/lib/status-labels';
import { cn } from '@/lib/utils';

type StatusTone = 'neutral' | 'attention' | 'danger';

const DANGER = new Set(['blocked', 'failed', 'overdue']);
const ATTENTION = new Set(['needs_attention', 'pending', 'processing']);

function statusTone(status: string): StatusTone {
  const normalized = status.trim().toLowerCase();
  if (DANGER.has(normalized)) return 'danger';
  if (ATTENTION.has(normalized)) return 'attention';
  return 'neutral';
}

interface StatusBadgeProps {
  status: string;
  label?: string;
  tone?: StatusTone;
  className?: string;
}

export function StatusBadge({
  status,
  label,
  tone = statusTone(status),
  className,
}: StatusBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'border-border bg-transparent font-sans text-fg-muted',
        tone === 'attention' && 'border-signal/40 bg-signal-soft text-fg',
        tone === 'danger' && 'border-danger/40 text-danger',
        className,
      )}
    >
      {label ?? statusLabel(status)}
    </Badge>
  );
}
