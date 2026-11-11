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
import { ConnectAgentDisclosure } from '@/components/connect-agent/connect-agent-disclosure';
import { ConnectAgentMemory } from '@/components/connect-agent/connect-agent-memory';
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
      <ConnectAgentTabs mcpUrl={mcpUrl} teamEmail={teamEmail} />
      <div className="divide-y divide-border">
        <ConnectAgentDisclosure
          title={
            <>
              Connected agents
              {grants.length > 0 ? (
                <span className="font-mono text-xs font-normal text-fg-dim">{grants.length}</span>
              ) : null}
            </>
          }
          defaultOpen={grants.length > 0}
        >
          <ConnectAgentAgents grants={grants} teamId={teamId} isAdmin={isAdmin} />
        </ConnectAgentDisclosure>
        <ConnectAgentDisclosure title="Add memory">
          <ConnectAgentMemory
            origin={origin}
            isAdmin={isAdmin}
            teamEmail={teamEmail}
            currentUserEmail={currentUserEmail}
            extraSenders={extraSenders}
            agentWebhookConfigured={agentWebhookConfigured}
          />
        </ConnectAgentDisclosure>
        <ConnectAgentDisclosure title="Timeline skill">
          <p className="text-sm leading-6 text-fg-muted">
            Download SKILL.md for clients that install a local skill. Tools:{' '}
            {TIMELINE_MCP_TOOLS.join(', ')}.
          </p>
          <Button asChild size="sm" variant="outline">
            <Link href={CONNECT_AGENT_SKILL_HREF} prefetch={false}>
              <Download aria-hidden="true" />
              Download SKILL.md
            </Link>
          </Button>
        </ConnectAgentDisclosure>
        <ConnectAgentDisclosure
          title={
            <>
              Advanced
              {keys.length > 0 ? (
                <span className="font-mono text-xs font-normal text-fg-dim">{keys.length}</span>
              ) : null}
            </>
          }
        >
          <ConnectAgentAdvanced keys={keys} mcpUrl={mcpUrl} isAdmin={isAdmin} />
        </ConnectAgentDisclosure>
      </div>
    </div>
  );
}
