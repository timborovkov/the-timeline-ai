import Link from 'next/link';

import { SetupShell } from '@/components/onboarding/setup-shell';
import { Button } from '@/components/ui/button';

export function CaptureUnavailable() {
  return (
    <SetupShell progress="Setup">
      <h1 className="text-2xl font-semibold tracking-tight">Capture unavailable</h1>
      <p className="mt-2 text-sm leading-6 text-fg-muted">
        This link is for a capture that is unavailable in the current workspace. Switch to the
        original workspace or open your current setup.
      </p>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button asChild>
          <Link href="/app">Go to Home</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/onboarding">Open current setup</Link>
        </Button>
      </div>
    </SetupShell>
  );
}
