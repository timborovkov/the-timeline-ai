import Link from 'next/link';

import { CopyableTextField } from '@/components/copyable-text-field';

export const HOME_TEAM_EMAIL_SECTION_ID = 'team-email';

export function HomeTeamEmail({ inboundEmail }: { inboundEmail: string | null }) {
  return (
    <section
      id={HOME_TEAM_EMAIL_SECTION_ID}
      aria-label="Team email"
      className="space-y-3 border-y border-border py-4 sm:px-1 scroll-mt-14"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-sm font-medium text-fg">Team email</p>
        <Link
          href="/app/team?section=email"
          className="text-xs text-fg-dim transition-colors hover:text-fg"
        >
          Email settings
        </Link>
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
