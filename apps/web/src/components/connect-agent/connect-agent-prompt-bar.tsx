'use client';

import { CopyButton } from '@/components/copy-button';
import { CONNECT_AGENT_SETUP_PROMPT, connectAgentTeamPrompt } from '@/lib/connect-agent-content';

export function ConnectAgentPromptBar({ teamEmail }: { teamEmail: string | null }) {
  const teamPrompt = connectAgentTeamPrompt(teamEmail);
  return (
    <section className="space-y-3 border-y border-border py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-2xl space-y-1">
          <h2 className="text-base font-semibold tracking-tight text-fg">Copy a setup prompt</h2>
          <p className="text-sm leading-6 text-fg-muted">
            Paste this into an agent to load Timeline from{' '}
            {CONNECT_AGENT_SETUP_PROMPT.split(' - ')[1]}. Prefer OAuth. Do not paste a static key
            into chat.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <CopyButton value={CONNECT_AGENT_SETUP_PROMPT} label="Copy setup prompt" />
          {teamEmail ? <CopyButton value={teamPrompt} label="Copy team prompt" /> : null}
        </div>
      </div>
      <pre
        translate="no"
        className="overflow-x-auto whitespace-pre-wrap break-words rounded-sm border border-border bg-surface-2 p-3 font-mono text-xs leading-5 text-fg"
      >
        <code>{teamEmail ? teamPrompt : CONNECT_AGENT_SETUP_PROMPT}</code>
      </pre>
    </section>
  );
}
