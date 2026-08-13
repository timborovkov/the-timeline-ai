import { ArrowRight, Link2 } from 'lucide-react';

import type { ConnectorContent } from '@/components/marketing/integrations/connector-content';
import type { CSSProperties } from 'react';

import styles from '@/components/marketing/integrations/records-to-answer.module.css';

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
      <div className={styles.question}>
        <span className={styles.index}>Question</span>
        <p>{connector.diagram.question}</p>
      </div>
      <div className={styles.flow}>
        <div className={styles.records} aria-label={`${connector.name} source records`}>
          {connector.diagram.records.map((record, index) => (
            <article
              key={`${record.label}-${record.time}`}
              className={styles.record}
              style={{ '--record-index': index } as CSSProperties}
            >
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
            {connector.diagram.records.map((record, index) => (
              <i
                key={`${record.label}-${record.time}`}
                style={{ '--marker-index': index } as CSSProperties}
              />
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
