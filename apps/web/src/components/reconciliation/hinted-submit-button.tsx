'use client';

import type { ReactNode } from 'react';

import { Button, type ButtonProps } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export function HintedSubmitButton({
  hint,
  children,
  ...props
}: ButtonProps & {
  hint: string;
  children: ReactNode;
}): ReactNode {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="submit" {...props} title={hint}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs font-sans text-xs font-normal leading-snug tracking-normal">
        {hint}
      </TooltipContent>
    </Tooltip>
  );
}
