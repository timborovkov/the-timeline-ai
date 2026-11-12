'use client';

import { CopyButton } from '@/components/copy-button';
import styles from '@/components/marketing/agents/agent-setup-card.module.css';
import { AGENT_SETUP_CARD, TIMELINE_AGENT_SETUP_COMMAND } from '@/components/marketing/copy';
import { ProviderLogo } from '@/components/provider-logo';
import { cn } from '@/lib/utils';

/**
 * Official agent marks on white tiles. Reuses the Connect-your-agent connector
 * assets rather than a second copy under /agents/. Never substitute letter discs.
 *
 * Sources (same files as CONNECT_AGENT_GUIDES):
 * - Claude: Simple Icons Anthropic starburst (`/connectors/claude.svg`)
 * - ChatGPT: Simple Icons OpenAI blossom (`/connectors/openai.svg`)
 * - Cursor: Simple Icons cube mirroring cursor.com (`/connectors/cursor.svg`)
 * - Grok: Wikimedia Commons XAI-Logo.svg (`/connectors/xai.svg`)
 * - OpenClaw: official pixel-lobster.svg (`/connectors/openclaw.svg`)
 * - Hermes: official Nous Hermes Agent icon (`/connectors/hermes.png`)
 */
const COMPATIBLE_AGENTS = [
  { name: 'Claude', src: '/connectors/claude.svg' },
  { name: 'ChatGPT', src: '/connectors/openai.svg' },
  { name: 'Cursor', src: '/connectors/cursor.svg' },
  { name: 'Grok', src: '/connectors/xai.svg' },
  { name: 'OpenClaw', src: '/connectors/openclaw.svg' },
  { name: 'Hermes', src: '/connectors/hermes.png' },
] as const;

export function AgentSetupCard({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  return (
    <aside className={cn(styles.card, compact && styles.compact, className)} data-agent-setup>
      <div className={styles.copy}>
        <p className={styles.title}>
          {compact ? 'Get started with your agent' : AGENT_SETUP_CARD.title}
        </p>
        <p className={styles.lede}>
          {compact ? 'Paste this into your agent to set up The Timeline.' : AGENT_SETUP_CARD.body}
        </p>
      </div>
      <ul className={styles.marks} aria-label="Compatible agents">
        {COMPATIBLE_AGENTS.map((agent) => (
          <li key={agent.name} className={styles.mark} title={agent.name}>
            <ProviderLogo src={agent.src} size={compact ? 'xs' : 'sm'} />
            <span className="sr-only">{agent.name}</span>
          </li>
        ))}
      </ul>
      <div className={styles.commandRow}>
        <code className={styles.command}>{TIMELINE_AGENT_SETUP_COMMAND}</code>
        <CopyButton
          publicFeedback
          value={TIMELINE_AGENT_SETUP_COMMAND}
          label="Copy setup command"
          appearance="icon"
          className={styles.copyButton}
        />
      </div>
    </aside>
  );
}
