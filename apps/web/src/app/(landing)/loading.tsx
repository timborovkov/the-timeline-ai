import { LandingRecoveryShell } from '@/app/(landing)/_landing-recovery-shell';
import styles from '@/app/(landing)/home.module.css';

export default function LandingLoading() {
  return (
    <LandingRecoveryShell>
      <output className="sr-only" aria-live="polite">
        Loading The Timeline
      </output>
      <section
        aria-busy="true"
        aria-label="The Timeline loading placeholder"
        className={`${styles.scene} ${styles.recoveryScene}`}
      >
        <div className={styles.recoveryCopy}>
          <div className={styles.sceneIndex}>
            <span>00 / 05</span>
            <span>Gathering evidence</span>
          </div>
          <h1 className={styles.recoveryTitle}>
            The work <em>becomes</em> the record.
          </h1>
          <p>Loading the sources, chronology, and cited answer that explain how Timeline works.</p>
        </div>
        <div className={styles.loadingSequence} aria-hidden="true">
          <div className={styles.loadingSignals}>
            {['Slack', 'Meeting', 'GitHub', 'Drive'].map((source, index) => (
              <span key={source}>
                <small>0{index + 1}</small>
                {source}
              </span>
            ))}
          </div>
          <div className={styles.loadingChronology} />
          <div className={styles.loadingAnswer}>
            <span />
            <span />
            <span />
          </div>
        </div>
      </section>
    </LandingRecoveryShell>
  );
}
