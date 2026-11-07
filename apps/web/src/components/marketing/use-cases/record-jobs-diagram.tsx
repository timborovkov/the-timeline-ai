import { ArrowDown, ArrowRight } from 'lucide-react';
import Link from 'next/link';

import { USE_CASES } from '@/components/marketing/use-cases/content';
import styles from '@/components/marketing/use-cases/record-jobs-diagram.module.css';

const SOURCES = ['Slack', 'Telegram', 'Email', 'Calls'] as const;

export function RecordJobsDiagram() {
  return (
    <figure className={styles.figure} data-record-jobs aria-labelledby="record-jobs-title">
      <figcaption id="record-jobs-title" className={styles.kicker}>
        One record, six jobs
      </figcaption>
      <div className={styles.flow}>
        <section className={styles.sources} aria-label="Where work enters">
          <h3>Conversations</h3>
          <ul>
            {SOURCES.map((source) => (
              <li key={source}>{source}</li>
            ))}
          </ul>
        </section>
        <div className={styles.transfer} aria-hidden="true">
          <span />
          <ArrowRight className={styles.arrowWide} />
          <ArrowDown className={styles.arrowNarrow} />
        </div>
        <section className={styles.record} aria-label="The work record">
          <h3>Work record</h3>
          <p>Source, time and visibility stay attached. Lasting changes wait for approval.</p>
        </section>
        <div className={styles.transfer} aria-hidden="true">
          <span />
          <ArrowRight className={styles.arrowWide} />
          <ArrowDown className={styles.arrowNarrow} />
        </div>
        <section className={styles.jobs} aria-label="Ways teams use the record">
          <h3>What teams do with it</h3>
          <ul>
            {USE_CASES.map((useCase) => (
              <li key={useCase.route}>
                <Link href={useCase.route}>{useCase.cardTitle}</Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </figure>
  );
}
