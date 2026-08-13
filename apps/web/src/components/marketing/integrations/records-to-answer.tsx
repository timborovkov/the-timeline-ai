import { ArrowRight, Link2 } from 'lucide-react';

import type { ConnectorContent } from '@/components/marketing/integrations/connector-content';

import styles from '@/components/marketing/integrations/records-to-answer.module.css';
import { PUBLIC_DEMO_DISCLOSURE } from '@/components/marketing/public-demo-story';

export function RecordsToAnswer({
  connector,
  compact = false,
}: {
  connector: ConnectorContent;
  compact?: boolean;
}) {
  return (
    <figure
      className={`${styles.figure} ${compact ? styles.compact : ''}`}
      aria-labelledby={`diagram-${connector.slug}`}
    >
      <figcaption id={`diagram-${connector.slug}`} className="sr-only">
        {connector.name} records enter a chronological Timeline and resolve into a cited answer.
      </figcaption>
      <p className="mb-4 font-mono text-[0.65rem] tracking-[0.12em] text-fg-dim uppercase">
        {PUBLIC_DEMO_DISCLOSURE}
      </p>
      <div className={styles.question}>
        <span className={styles.index}>Question</span>
        <p>{connector.diagram.question}</p>
      </div>
      <div className={styles.flow}>
        <div className={styles.records} aria-label={`${connector.name} source records`}>
          {connector.diagram.records.map((record) => (
            <article key={`${record.label}-${record.time}`} className={styles.record}>
              <span>{record.time}</span>
              <strong>{record.label}</strong>
              <p>{record.detail}</p>
            </article>
          ))}
        </div>
        <div className={styles.transfer} aria-hidden="true">
          <span />
          <ArrowRight />
        </div>
        <div className={styles.chronology}>
          <span className={styles.index}>Chronology</span>
          <div className={styles.rail} aria-hidden="true">
            {connector.diagram.records.map((record) => (
              <i key={`${record.label}-${record.time}`} />
            ))}
          </div>
          <p>Immutable events keep their source and order.</p>
        </div>
        <div className={styles.transfer} aria-hidden="true">
          <span />
          <ArrowRight />
        </div>
        <article className={styles.answer}>
          <span className={styles.index}>Cited answer</span>
          <p>{connector.diagram.answer}</p>
          <div className={styles.citations} aria-label="Answer citations">
            {connector.diagram.citations.map((citation, index) => (
              <span key={citation}>
                <Link2 aria-hidden="true" />
                <span className="sr-only">Citation {index + 1}: </span>
                {citation}
              </span>
            ))}
          </div>
        </article>
      </div>
    </figure>
  );
}
