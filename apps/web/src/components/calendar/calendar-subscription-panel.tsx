'use client';

import { Link2, RefreshCw, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
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
  const [subscription, setSubscription] = useState(initialSubscription);
  const [revealedUrl, setRevealedUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'reset' | 'disable' | null>(null);

  async function createOrReset() {
    setBusy(true);
    try {
      const res = await fetch('/api/team/calendar-subscription', { method: 'POST' });
      if (!res.ok) {
        toast.error('Calendar subscription update failed');
        return;
      }
      const data = (await res.json()) as SubscriptionResponse;
      setSubscription(data.subscription);
      setRevealedUrl(data.url);
      setConfirmAction(null);
      toast.success(subscription ? 'Calendar URL reset' : 'Calendar URL created');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const res = await fetch('/api/team/calendar-subscription', { method: 'DELETE' });
      if (!res.ok) {
        toast.error('Calendar subscription disable failed');
        return;
      }
      setSubscription(null);
      setRevealedUrl(null);
      setConfirmAction(null);
      toast.success('Calendar URL disabled');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-sm border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Link2 className="size-4 text-fg-muted" aria-hidden />
            Calendar subscription
          </div>
          <div className="mt-1 font-mono text-xs text-fg-muted">
            {subscription
              ? `${subscription.prefix}… · created ${dateLabel(subscription.createdAt)}`
              : 'No active URL'}
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          disabled={busy}
          onClick={() => {
            if (subscription) setConfirmAction('reset');
            else void createOrReset();
          }}
        >
          <RefreshCw className="size-4" aria-hidden />
          {subscription ? 'Reset URL' : 'Create URL'}
        </Button>
        {subscription ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setConfirmAction('disable');
            }}
          >
            <Trash2 className="size-4" aria-hidden />
            Disable
          </Button>
        ) : null}
      </div>

      {revealedUrl ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <code className="min-w-0 flex-1 break-all rounded-sm border border-signal/40 bg-surface-2 px-2 py-1.5 font-mono text-xs">
            {revealedUrl}
          </code>
          <CopyButton value={revealedUrl} />
          <CopyButton value={webcalUrl(revealedUrl)} label="Copy webcal" />
        </div>
      ) : subscription ? (
        <p className="mt-2 text-xs text-fg-muted">Reset to reveal a fresh URL.</p>
      ) : null}

      <Dialog
        open={confirmAction !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null);
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
                setConfirmAction(null);
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
              {confirmAction === 'reset' ? 'Reset URL' : 'Disable'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
