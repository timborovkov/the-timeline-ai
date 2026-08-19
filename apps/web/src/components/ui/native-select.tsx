import * as React from 'react';

import { cn } from '@/lib/utils';

export const nativeSelectClassName =
  'h-9 w-full min-w-0 rounded-sm border border-input bg-background px-2.5 text-sm text-fg transition-colors hover:border-border-strong ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

type NativeSelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & {
  ref?: React.Ref<HTMLSelectElement>;
};

function NativeSelect({ className, ref, ...props }: NativeSelectProps) {
  return <select className={cn(nativeSelectClassName, className)} ref={ref} {...props} />;
}
NativeSelect.displayName = 'NativeSelect';

export { NativeSelect };
