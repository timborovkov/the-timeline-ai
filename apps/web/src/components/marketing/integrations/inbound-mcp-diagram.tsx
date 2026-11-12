import { ArrowDown, ArrowRight } from 'lucide-react';
import Image from 'next/image';

import { Logo } from '@/components/brand/logo';
import styles from '@/components/marketing/integrations/inbound-mcp-diagram.module.css';
import { MCP_GUIDE_HOSTED_TOOL_NAMES } from '@/components/marketing/integrations/mcp-guide-content';
import { MotionFigure } from '@/components/marketing/motion-figure';

const TOOL_MARKS: Record<(typeof MCP_GUIDE_HOSTED_TOOL_NAMES)[number], string> = {
  Notion: '/connectors/notion.svg',
  Jira: '/connectors/jira.svg',
  Confluence: '/connectors/confluence.svg',
  Stripe: '/connectors/stripe.svg',
};

export function InboundMcpDiagram() {
  return (
    <MotionFigure className={styles.figure} data-inbound-mcp aria-labelledby="inbound-mcp-title">
      <figcaption className={styles.caption}>
        <span id="inbound-mcp-title" className={styles.kicker}>
          Live lookup
        </span>
      </figcaption>
      <p className={styles.lede}>
        The Timeline Agent can call connected MCP tools during a question. That is a live lookup,
        not background sync, and not the path external agents use to read Timeline.
      </p>
      <div className={styles.flow}>
        <section className={styles.column} aria-labelledby="inbound-mcp-agent">
          <Logo ariaHidden className={styles.mark} />
          <h3 id="inbound-mcp-agent">The Timeline Agent</h3>
          <p>Ask in the app. When a live lookup helps, the agent calls a connected tool.</p>
        </section>
        <div className={styles.transfer} aria-hidden="true">
          <span data-flow-line />
          <ArrowRight className={styles.arrowWide} />
          <ArrowDown className={styles.arrowNarrow} />
        </div>
        <section className={styles.core} aria-labelledby="inbound-mcp-lookup">
          <h3 id="inbound-mcp-lookup">Live lookup</h3>
          <p>Results answer this question. They do not become native history sync.</p>
        </section>
        <div className={styles.transfer} aria-hidden="true">
          <span data-flow-line />
          <ArrowRight className={styles.arrowWide} />
          <ArrowDown className={styles.arrowNarrow} />
        </div>
        <section className={styles.column} aria-labelledby="inbound-mcp-tools">
          <h3 id="inbound-mcp-tools">Connected MCP tools</h3>
          <p>Catalog shortcuts and custom servers the agent can call.</p>
          <ul aria-label="Hosted catalog tools">
            {MCP_GUIDE_HOSTED_TOOL_NAMES.map((name) => (
              <li key={name}>
                <span className={styles.toolMark}>
                  <Image src={TOOL_MARKS[name]} alt="" width={16} height={16} />
                </span>
                <strong>{name}</strong>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </MotionFigure>
  );
}
