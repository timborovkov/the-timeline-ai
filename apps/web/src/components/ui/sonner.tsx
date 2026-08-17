'use client';

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = 'system' } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps['theme']}
      className="toaster group"
      position="bottom-right"
      visibleToasts={3}
      closeButton
      icons={{
        success: <CircleCheckIcon className="size-4 text-status-success" />,
        info: <InfoIcon className="size-4 text-fg-muted" />,
        warning: <TriangleAlertIcon className="size-4 text-status-progress" />,
        error: <OctagonXIcon className="size-4 text-danger" />,
        loading: (
          <Loader2Icon className="size-4 animate-spin text-fg-muted motion-reduce:animate-none" />
        ),
      }}
      toastOptions={{
        classNames: {
          toast: 'group toast border border-border bg-popover text-popover-foreground shadow-md',
          title: 'text-sm text-fg',
          description: 'text-xs text-fg-muted',
          actionButton: 'bg-surface-2 text-fg hover:bg-surface',
          cancelButton: 'bg-transparent text-fg-muted',
          closeButton: 'border-border bg-popover text-fg-muted',
        },
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius-lg)',
          '--success-bg': 'var(--popover)',
          '--success-text': 'var(--popover-foreground)',
          '--success-border': 'var(--border)',
          '--error-bg': 'var(--popover)',
          '--error-text': 'var(--popover-foreground)',
          '--error-border': 'var(--border)',
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
