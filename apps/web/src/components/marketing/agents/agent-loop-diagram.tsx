import { ArrowDown, ArrowRight } from 'lucide-react';
import Image from 'next/image';

import { Logo } from '@/components/brand/logo';
import styles from '@/components/marketing/agents/agent-loop-diagram.module.css';
import { FICTIONAL_EXAMPLE_LABEL } from '@/components/marketing/copy';

const WRITE_PATHS = [
  { name: 'timeline.remember', body: 'A cited note from an agent.' },
  { name: 'Ingest email', body: 'Forward, CC or BCC to the team address.' },
  { name: 'Ingest webhook', body: 'Authenticated POST with a tli_ key.' },
] as const;

const READ_TOOLS = [
  { name: 'timeline.search', body: 'Find evidence in the record.' },
  { name: 'timeline.get', body: 'Open a named event or subject.' },
  { name: 'timeline.subject', body: 'Load a company, project or person.' },
  { name: 'timeline.ask', body: 'Ask a question with citations.' },
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
        External agents add notes like teammates, then read the same cited record over MCP. Neither
        path changes canonical records on its own.
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
          <p>A note, forwarded email or webhook lands as cited ingest evidence.</p>
          <ul>
            {WRITE_PATHS.map((path) => (
              <li key={path.name}>
                <code>{path.name}</code>
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
          <h3 id="agent-loop-read">Agents read Timeline over MCP</h3>
          <p>Hosted tools on https://thetimeline.cc/api/mcp/server.</p>
          <ul>
            {READ_TOOLS.map((tool) => (
              <li key={tool.name}>
                <code>{tool.name}</code>
                <span>{tool.body}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </figure>
  );
}
