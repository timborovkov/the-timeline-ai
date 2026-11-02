'use client';

import type { InboundEmailSettings } from '@/app/app/sources/connection-directory';

import { CopyableTextField } from '@/components/copyable-text-field';
import { InboundEmailPlaceholderNotice, InboundEmailWhitelistForm } from '@/components/team-forms';

export function EmailSetupBody({
  isAdmin,
  inboundEmail,
}: {
  isAdmin: boolean;
  inboundEmail: InboundEmailSettings;
}) {
  if (isAdmin) {
    return <InboundEmailWhitelistForm {...inboundEmail} />;
  }
  return (
    <div className="space-y-3">
      <CopyableTextField
        id="connections-inbound-email"
        label="Team email address"
        value={inboundEmail.inboundEmail}
        copyLabel="Copy address"
        description="Forward, CC, or BCC mail to this address to capture it on the timeline."
      />
      {inboundEmail.placeholderInbound ? <InboundEmailPlaceholderNotice /> : null}
      <p className="text-sm text-fg-muted">
        Only team administrators can change the sender whitelist.
      </p>
    </div>
  );
}
