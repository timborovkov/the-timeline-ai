import { Download } from 'lucide-react';
import Link from 'next/link';

import {
  ConnectAgentAdvanced,
  type ConnectAgentKey,
} from '@/components/connect-agent/connect-agent-advanced';
import {
  ConnectAgentAgents,
  type ConnectAgentGrant,
} from '@/components/connect-agent/connect-agent-agents';
import { ConnectAgentMemory } from '@/components/connect-agent/connect-agent-memory';
import { ConnectAgentPromptBar } from '@/components/connect-agent/connect-agent-prompt-bar';
import { ConnectAgentTabs } from '@/components/connect-agent/connect-agent-tabs';
import { RedirectActionToast } from '@/components/redirect-action-toast';
import { Button } from '@/components/ui/button';
import { CONNECT_AGENT_SKILL_HREF, TIMELINE_MCP_TOOLS } from '@/lib/connect-agent-content';

export function ConnectAgentScreen({
  teamId,
  mcpUrl,
  origin,
  isAdmin,
  teamEmail,
  currentUserEmail,
  extraSenders,
  grants,
  keys,
  agentWebhookConfigured,
  revokedNotice,
  revokeError,
}: {
  teamId: string;
  mcpUrl: string;
  origin: string;
  isAdmin: boolean;
  teamEmail: string | null;
  currentUserEmail: string;
  extraSenders: string[];
  grants: ConnectAgentGrant[];
  keys: ConnectAgentKey[];
  agentWebhookConfigured: boolean;
  revokedNotice?: boolean;
  revokeError?: string | null;
}) {
  return (
    <div className="space-y-8">
      <RedirectActionToast
        id="connect-agent:revoke"
        error={
          revokeError === 'not_found'
            ? 'That grant was already revoked.'
            : revokeError
              ? 'Could not revoke access. Try again.'
              : null
        }
        success={
          revokedNotice
            ? 'Access revoked. That agent cannot call Timeline on its next request.'
            : null
        }
      />
      <ConnectAgentPromptBar teamEmail={teamEmail} />
      <ConnectAgentTabs mcpUrl={mcpUrl} />
      <ConnectAgentAgents
        grants={grants}
        teamId={teamId}
        revokedNotice={revokedNotice}
        revokeError={revokeError}
      />
      <ConnectAgentMemory
        origin={origin}
        isAdmin={isAdmin}
        teamEmail={teamEmail}
        currentUserEmail={currentUserEmail}
        extraSenders={extraSenders}
        agentWebhookConfigured={agentWebhookConfigured}
      />
      <section
        className="space-y-3 border-y border-border py-4"
        aria-labelledby="connect-agent-skill"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 max-w-2xl space-y-1">
            <h2 id="connect-agent-skill" className="text-base font-semibold tracking-tight text-fg">
              Timeline skill
            </h2>
            <p className="text-sm leading-6 text-fg-muted">
              Download SKILL.md for clients that install a local skill. Tools:{' '}
              {TIMELINE_MCP_TOOLS.join(', ')}.
            </p>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link href={CONNECT_AGENT_SKILL_HREF} prefetch={false}>
              <Download aria-hidden="true" />
              Download SKILL.md
            </Link>
          </Button>
        </div>
      </section>
      <ConnectAgentAdvanced keys={keys} mcpUrl={mcpUrl} isAdmin={isAdmin} />
    </div>
  );
}
