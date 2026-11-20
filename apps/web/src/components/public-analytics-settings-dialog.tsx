'use client';

import Link from 'next/link';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { isPublicBrowserAnalyticsConfigured } from '@/lib/public-browser-analytics';

export default function AnalyticsSettingsDialog({
  choice,
  onOpenChange,
  onReject,
  onAccept,
}: {
  choice?: 'accepted' | 'rejected';
  onOpenChange: (open: boolean) => void;
  onReject: () => void;
  onAccept: () => void;
}) {
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="overscroll-contain border-border bg-bg sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Analytics preferences</DialogTitle>
          <DialogDescription>
            PostHog is the processor for optional public analytics. Its purpose is to measure visits
            and selected actions on public pages, and it never runs in your private workspace. We
            also measure referring sites and popular pages, using public page paths and referring
            website origins without query strings or fragments. PostHog currently documents
            seven-year product-event retention, which exceeds Timeline&apos;s 90-day target. We
            separately count personless surface requests in broad page categories. Bots and retries
            can contribute, so those totals are not visitor or session metrics.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-fg-muted" aria-live="polite">
          {!isPublicBrowserAnalyticsConfigured
            ? 'Optional public analytics is unavailable on this deployment.'
            : choice === 'accepted'
              ? 'Optional public analytics is currently accepted.'
              : choice === 'rejected'
                ? 'Optional public analytics is currently rejected.'
                : 'You have not made an analytics choice yet.'}
        </p>
        <p className="text-sm text-fg-muted">
          Rejecting does not affect public pages, signup, or the app. Read the{' '}
          <Link
            href="/cookies"
            className="rounded-sm text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            cookies and similar technologies notice
          </Link>
          .
        </p>
        {isPublicBrowserAnalyticsConfigured ? (
          <DialogFooter className="sm:justify-stretch">
            <Button className="flex-1" variant="outline" onClick={onReject}>
              Reject analytics
            </Button>
            <Button className="flex-1" variant="outline" onClick={onAccept}>
              Accept analytics
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
