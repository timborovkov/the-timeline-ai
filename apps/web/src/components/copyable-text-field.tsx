'use client';

import { CopyButton } from '@/components/copy-button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export function CopyableTextField({
  id,
  label,
  value,
  emptyLabel = 'Not configured',
  copyLabel,
  description,
  className,
}: {
  id: string;
  label: string;
  value: string | null | undefined;
  emptyLabel?: string;
  copyLabel?: string;
  description?: string;
  className?: string;
}) {
  const configured = Boolean(value);
  const displayValue = value ?? emptyLabel;
  const descriptionId = description ? `${id}-description` : undefined;

  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={id} size="sm">
        {label}
      </Label>
      <div className="flex min-w-0 items-center gap-2">
        <Input
          id={id}
          type="text"
          readOnly
          value={displayValue}
          aria-describedby={descriptionId}
          className={cn(
            'min-w-0 flex-1 font-mono text-xs',
            configured ? 'text-fg' : 'text-fg-muted',
          )}
          onFocus={(event) => {
            event.currentTarget.select();
          }}
        />
        {value ? <CopyButton value={value} label={copyLabel ?? label} /> : null}
      </div>
      {description ? (
        <p id={descriptionId} className="text-xs text-fg-muted">
          {description}
        </p>
      ) : null}
    </div>
  );
}
