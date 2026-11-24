import { CopyButton } from '@/components/copy-button';
import { cn } from '@/lib/utils';

export function CopyableCodeValue({
  value,
  copyLabel,
  valueClassName,
}: {
  value: string;
  copyLabel: string;
  valueClassName?: string;
}) {
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-1 gap-y-1.5">
      <code translate="no" className={cn('min-w-0 break-all font-mono text-xs', valueClassName)}>
        {value}
      </code>
      <CopyButton value={value} label={copyLabel} appearance="icon" />
    </div>
  );
}
