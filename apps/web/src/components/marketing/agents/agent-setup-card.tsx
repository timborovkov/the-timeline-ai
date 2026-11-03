'use client';

import { CopyButton } from '@/components/copy-button';
import styles from '@/components/marketing/agents/agent-setup-card.module.css';
import { TIMELINE_AGENT_SETUP_COMMAND } from '@/components/marketing/copy';
import { cn } from '@/lib/utils';

const AGENT_MARKS = [
  { name: 'Claude', mark: 'C' },
  { name: 'ChatGPT', mark: 'G' },
  { name: 'Cursor', mark: 'Cu' },
  { name: 'Grok', mark: 'X' },
  { name: 'OpenClaw', mark: 'O' },
  { name: 'Hermes', mark: 'H' },
] as const;

export function AgentSetupCard({ className }: { className?: string }) {
  return (
    <aside className={cn(styles.card, className)} data-agent-setup>
      <div className={styles.copy}>
        <p className={styles.kicker}>For agents</p>
        <p className={styles.title}>Give this to your agent</p>
        <p className={styles.lede}>
          Paste the line into Claude, ChatGPT, Cursor, Grok, OpenClaw or Hermes. It reads the public
          setup file and connects to The Timeline.
        </p>
      </div>
      <ul className={styles.marks} aria-label="Compatible agents">
        {AGENT_MARKS.map((agent) => (
          <li key={agent.name} className={styles.mark}>
            <span aria-hidden="true">{agent.mark}</span>
            {agent.name}
          </li>
        ))}
      </ul>
      <div className={styles.commandRow}>
        <code className={styles.command}>{TIMELINE_AGENT_SETUP_COMMAND}</code>
        <CopyButton
          value={TIMELINE_AGENT_SETUP_COMMAND}
          label="Copy setup command"
          appearance="icon"
          className={styles.copyButton}
        />
      </div>
    </aside>
  );
}
