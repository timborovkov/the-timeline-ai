import Link from 'next/link';

import { CopyableTextField } from '@/components/copyable-text-field';
import { Button } from '@/components/ui/button';

export const HOME_TEAM_EMAIL_SECTION_ID = 'team-email';

export function HomeTeamEmail({ inboundEmail }: { inboundEmail: string | null }) {
  return (
    <section
      id={HOME_TEAM_EMAIL_SECTION_ID}
      aria-label="Team email"
      className="space-y-3 scroll-mt-14"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold text-fg">Capture by email</h2>
        <Button asChild variant="outline" size="sm">
          <Link href="/app/team?section=email">Email settings</Link>
        </Button>
      </div>
      <CopyableTextField
        id="home-team-email"
        label="Team email address"
        value={inboundEmail}
        copyLabel="Copy team email"
        description="Forward, CC, or BCC mail to this address to capture it on the timeline."
      />
    </section>
  );
}
