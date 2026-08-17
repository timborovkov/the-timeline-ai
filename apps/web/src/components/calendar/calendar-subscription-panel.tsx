'use client';

import { Link2, RefreshCw, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useReducer } from 'react';
import { toast } from 'sonner';

import { CopyButton } from '@/components/copy-button';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { ItemActionGroup, ItemOverflowMenu } from '@/components/ui/item-actions';

interface CalendarSubscription {
  prefix: string;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CalendarSubscriptionPanelProps {
  subscription: CalendarSubscription | null;
}

interface SubscriptionResponse {
  subscription: CalendarSubscription;
  url: string;
}

interface CalendarSubscriptionPanelState {
  subscription: CalendarSubscription | null;
  revealedUrl: string | null;
  busy: boolean;
  error: string | null;
  confirmAction: 'reset' | 'disable' | null;
}

function calendarSubscriptionPanelReducer(
  state: CalendarSubscriptionPanelState,
  action: Partial<CalendarSubscriptionPanelState>,
): CalendarSubscriptionPanelState {
  return { ...state, ...action };
}

function webcalUrl(url: string): string {
  return url.replace(/^https?:/, 'webcal:');
}

function dateLabel(value: string | null): string {
  return value ? new Date(value).toLocaleString() : 'never';
}

export function CalendarSubscriptionPanel({
  subscription: initialSubscription,
}: CalendarSubscriptionPanelProps) {
  const router = useRouter();
  const [state, dispatch] = useReducer(calendarSubscriptionPanelReducer, {
    subscription: initialSubscription,
    revealedUrl: null,
    busy: false,
    error: null,
    confirmAction: null,
  });
  const { subscription, revealedUrl, busy, error, confirmAction } = state;

  async function createOrReset() {
    const action = subscription ? 'reset' : 'create';
    dispatch({ busy: true, error: null });
    try {
      const res = await fetch('/api/team/calendar-subscription', { method: 'POST' });
      if (!res.ok) {
        throw new Error('calendar_subscription_update_failed');
      }
      const data = (await res.json()) as SubscriptionResponse;
      dispatch({ subscription: data.subscription, revealedUrl: data.url, confirmAction: null });
      toast.success(action === 'reset' ? 'Calendar URL reset' : 'Calendar URL created');
      router.refresh();
    } catch {
      const message =
        action === 'reset'
          ? 'Unable to reset the calendar URL. Try again.'
          : 'Unable to create the calendar URL. Try again.';
      dispatch({ error: message });
      toast.error(message);
    } finally {
      dispatch({ busy: false });
    }
  }

  async function disable() {
    dispatch({ busy: true, error: null });
    try {
      const res = await fetch('/api/team/calendar-subscription', { method: 'DELETE' });
      if (!res.ok) {
        throw new Error('calendar_subscription_disable_failed');
      }
      dispatch({ subscription: null, revealedUrl: null, confirmAction: null });
      toast.success('Calendar URL disabled');
      router.refresh();
    } catch {
      const message = 'Unable to disable the calendar URL. Try again.';
      dispatch({ error: message });
      toast.error(message);
    } finally {
      dispatch({ busy: false });
    }
  }

  return (
    <section
      className="rounded-md border border-border bg-surface p-4"
      aria-labelledby="calendar-subscription-heading"
      aria-busy={busy}
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Link2 className="size-4 shrink-0 text-fg-muted" aria-hidden="true" />
            <h2 id="calendar-subscription-heading" className="text-base font-semibold text-fg">
              Calendar subscription
            </h2>
          </div>
          <p className="mt-1 text-sm text-fg-muted">
            {subscription
              ? `A private URL is active · created ${dateLabel(subscription.createdAt)}`
              : 'Create a private URL to see Timeline events in your calendar app.'}
          </p>
          {subscription ? (
            <p className="mt-1 text-xs text-fg-muted">
              {subscription.lastUsedAt
                ? `Last accessed ${dateLabel(subscription.lastUsedAt)}`
                : 'Not yet accessed.'}
            </p>
          ) : null}
        </div>
        <ItemActionGroup label="Actions for calendar subscription">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => {
              if (subscription) dispatch({ confirmAction: 'reset' });
              else void createOrReset();
            }}
          >
            <RefreshCw className="size-4" aria-hidden />
            {subscription ? 'Reset URL' : 'Create URL'}
          </Button>
          {subscription ? (
            <ItemOverflowMenu targetLabel="calendar subscription">
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                disabled={busy}
                onSelect={() => {
                  dispatch({ confirmAction: 'disable' });
                }}
              >
                <Trash2 className="size-4" aria-hidden />
                Disable URL
              </DropdownMenuItem>
            </ItemOverflowMenu>
          ) : null}
        </ItemActionGroup>
      </div>

      {revealedUrl ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <p className="w-full text-sm text-fg-muted">
            This private URL is shown once. Copy it before you leave this page.
          </p>
          <code className="min-w-0 flex-1 break-all rounded-sm border border-signal/40 bg-surface-2 px-2 py-1.5 font-mono text-xs">
            {revealedUrl}
          </code>
          <CopyButton value={revealedUrl} />
          <CopyButton value={webcalUrl(revealedUrl)} label="Copy webcal" />
        </div>
      ) : subscription ? (
        <p className="mt-3 text-sm text-fg-muted">
          Reset the URL to copy a fresh private link. Reset it if the current link was shared.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      ) : null}

      <Dialog
        open={confirmAction !== null}
        onOpenChange={(open) => {
          if (!open) dispatch({ confirmAction: null });
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirmAction === 'reset' ? 'Reset calendar URL?' : 'Disable calendar URL?'}
            </DialogTitle>
          </DialogHeader>
          <DialogDescription>
            {confirmAction === 'reset'
              ? 'The old URL will stop working in calendar apps.'
              : 'Calendar apps using this URL will stop updating.'}
          </DialogDescription>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                dispatch({ confirmAction: null });
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant={confirmAction === 'disable' ? 'destructive' : 'default'}
              disabled={busy}
              onClick={() => {
                if (confirmAction === 'reset') void createOrReset();
                if (confirmAction === 'disable') void disable();
              }}
            >
              {confirmAction === 'reset' ? 'Reset URL' : 'Disable URL'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
