'use client';

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

function useToastPosition(): NonNullable<ToasterProps['position']> {
  const [position, setPosition] = useState<NonNullable<ToasterProps['position']>>('bottom-right');
  useEffect(() => {
    const media = window.matchMedia('(max-width: 639px)');
    const apply = () => {
      setPosition(media.matches ? 'bottom-center' : 'bottom-right');
    };
    apply();
    media.addEventListener('change', apply);
    return () => {
      media.removeEventListener('change', apply);
    };
  }, []);
  return position;
}

const toastActionButtonStyle = {
  background: 'var(--surface-2)',
  color: 'var(--fg)',
  border: '1px solid var(--border)',
  boxShadow: 'none',
} as const;

/**
 * Sonner injects `[data-button] { color: var(--normal-bg); background:
 * var(--normal-text) }` into document.head at import time. That inverts Undo
 * against the toast. This sheet renders with the toaster (in body) so it wins
 * that later-injected rule. Light toasts keep a light button; dark toasts keep
 * a dark button.
 */
const toastActionButtonOverride = `
[data-sonner-toaster][data-sonner-theme] [data-sonner-toast][data-styled='true'] [data-button][data-action] {
  background: var(--surface-2) !important;
  color: var(--fg) !important;
  border: 1px solid var(--border) !important;
  box-shadow: none !important;
}
[data-sonner-toaster][data-sonner-theme] [data-sonner-toast][data-styled='true'] [data-button][data-action]:hover {
  background: var(--surface) !important;
  color: var(--fg) !important;
}
`;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = 'system' } = useTheme();
  const position = useToastPosition();

  return (
    <>
      <style>{toastActionButtonOverride}</style>
      <Sonner
        theme={theme as ToasterProps['theme']}
        className="toaster group"
        position={position}
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
          actionButtonStyle: toastActionButtonStyle,
          classNames: {
            toast: 'group toast border border-border bg-popover text-popover-foreground shadow-md',
            title: 'text-sm text-fg',
            description: 'text-xs text-fg-muted',
            actionButton: '!bg-surface-2 !text-fg hover:!bg-surface !border !border-border',
            cancelButton: '!bg-transparent !text-fg-muted',
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
    </>
  );
};

export { Toaster };
