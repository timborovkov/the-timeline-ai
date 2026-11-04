'use client';

import { CopyButton } from '@/components/copy-button';
import { CONNECT_AGENT_SETUP_PROMPT, connectAgentTeamPrompt } from '@/lib/connect-agent-content';

export function ConnectAgentPromptBar({ teamEmail }: { teamEmail: string | null }) {
  const teamPrompt = connectAgentTeamPrompt(teamEmail);
  return (
    <div className="flex flex-wrap gap-2">
      <CopyButton value={CONNECT_AGENT_SETUP_PROMPT} label="Copy setup prompt" />
      {teamEmail ? <CopyButton value={teamPrompt} label="Copy team prompt" /> : null}
    </div>
  );
}
