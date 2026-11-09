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
import { GOOGLE_DRIVE_LIMITED_USE } from '@/lib/google-drive-limited-use';

export function GoogleDriveConnectDisclosure({
  open,
  onOpenChange,
  onContinue,
  pending = false,
  continueLabel = 'Continue to Google',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onContinue: () => void;
  pending?: boolean;
  continueLabel?: string;
}) {
  const facts = [
    GOOGLE_DRIVE_LIMITED_USE.access,
    GOOGLE_DRIVE_LIMITED_USE.use,
    GOOGLE_DRIVE_LIMITED_USE.storage,
    GOOGLE_DRIVE_LIMITED_USE.sharing,
    GOOGLE_DRIVE_LIMITED_USE.deletion,
    GOOGLE_DRIVE_LIMITED_USE.processors,
    GOOGLE_DRIVE_LIMITED_USE.training,
    GOOGLE_DRIVE_LIMITED_USE.policy,
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-slot="google-drive-connect-disclosure"
        className="max-h-[min(85dvh,40rem)] overflow-y-auto sm:max-w-lg"
        aria-describedby="google-drive-connect-disclosure-summary"
      >
        <DialogHeader>
          <DialogTitle>{GOOGLE_DRIVE_LIMITED_USE.title}</DialogTitle>
          <DialogDescription id="google-drive-connect-disclosure-summary">
            {GOOGLE_DRIVE_LIMITED_USE.summary}
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-2 text-sm text-fg">
          {facts.map((fact) => (
            <li key={fact}>{fact}</li>
          ))}
        </ul>
        <p className="text-sm text-fg-muted">
          <Link href="/privacy" className="underline underline-offset-4 hover:text-fg">
            Privacy Policy
          </Link>
        </p>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              onOpenChange(false);
            }}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onContinue}
            disabled={pending}
            aria-busy={pending || undefined}
          >
            {pending ? 'Opening Google…' : continueLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
