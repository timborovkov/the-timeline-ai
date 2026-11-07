import { ArrowDown, ArrowRight } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';

import { Logo } from '@/components/brand/logo';
import styles from '@/components/marketing/agents/agent-loop-diagram.module.css';
import { FICTIONAL_EXAMPLE_LABEL } from '@/components/marketing/copy';

const WRITE_PATHS = [
  { name: 'Remember a note', body: 'An agent adds a cited note to the record.' },
  { name: 'Forward email', body: 'CC or BCC the team address.' },
  { name: 'Send a webhook', body: 'An authenticated ingest webhook.' },
] as const;

const READ_TOOLS = [
  { name: 'Search', body: 'Find evidence in the record.' },
  { name: 'Open a record', body: 'Load an event, company or person.' },
  { name: 'Ask', body: 'Get an answer with citations.' },
] as const;

const CLIENTS = [
  { name: 'Claude', src: '/connectors/claude.svg' },
  { name: 'ChatGPT', src: '/connectors/openai.svg' },
  { name: 'Cursor', src: '/connectors/cursor.svg' },
  { name: 'Grok', src: '/connectors/xai.svg' },
] as const;

export function AgentLoopDiagram() {
  return (
    <figure className={styles.figure} data-agent-loop aria-labelledby="agent-loop-title">
      <figcaption className={styles.caption}>
        <span id="agent-loop-title" className={styles.kicker}>
          Write in · read out
        </span>
        <span className={styles.disclosure}>{FICTIONAL_EXAMPLE_LABEL}</span>
      </figcaption>
      <p className={styles.lede}>
        External agents add notes like teammates, then read the same cited record. Connecting
        third-party tools so The Timeline Agent can look them up live is a different path, on{' '}
        <Link href="/integrations/mcp">Connect MCP tools</Link>.
      </p>
      <div className={styles.clients} aria-label="Compatible agents">
        {CLIENTS.map((client) => (
          <span key={client.name} className={styles.client}>
            <span className={styles.clientMark}>
              <Image src={client.src} alt="" width={16} height={16} />
            </span>
            {client.name}
          </span>
        ))}
      </div>
      <div className={styles.flow}>
        <section className={styles.column} aria-labelledby="agent-loop-write">
          <h3 id="agent-loop-write">Agents write into Timeline</h3>
          <p>A note, forwarded email or webhook lands as cited evidence.</p>
          <ul>
            {WRITE_PATHS.map((path) => (
              <li key={path.name}>
                <strong>{path.name}</strong>
                <span>{path.body}</span>
              </li>
            ))}
          </ul>
        </section>
        <div className={styles.transfer} aria-hidden="true">
          <span data-flow-line />
          <ArrowRight className={styles.arrowWide} />
          <ArrowDown className={styles.arrowNarrow} />
        </div>
        <section className={styles.core} aria-labelledby="agent-loop-record">
          <Logo ariaHidden className={styles.mark} />
          <h3 id="agent-loop-record">The Timeline</h3>
          <p>Cited work record. Source, time and visibility stay attached.</p>
        </section>
        <div className={styles.transfer} aria-hidden="true">
          <span data-flow-line />
          <ArrowRight className={styles.arrowWide} />
          <ArrowDown className={styles.arrowNarrow} />
        </div>
        <section className={styles.column} aria-labelledby="agent-loop-read">
          <h3 id="agent-loop-read">Agents read Timeline</h3>
          <p>They connect over MCP and search the same cited record.</p>
          <ul>
            {READ_TOOLS.map((tool) => (
              <li key={tool.name}>
                <strong>{tool.name}</strong>
                <span>{tool.body}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </figure>
  );
}
