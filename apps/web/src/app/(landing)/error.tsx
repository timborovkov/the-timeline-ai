'use client';

import { LandingRecoveryShell } from '@/app/(landing)/_landing-recovery-shell';
import styles from '@/app/(landing)/home.module.css';
import { ErrorState } from '@/components/error-state';

export default function LandingError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <LandingRecoveryShell>
      <section className={`${styles.scene} ${styles.recoveryScene}`}>
        <header className={styles.recoveryCopy}>
          <div className={styles.sceneIndex}>
            <span>00 / 07</span>
            <span>Evidence interrupted</span>
          </div>
          <h1 className={styles.recoveryTitle}>
            The record did not <em>resolve.</em>
          </h1>
          <p>
            The source material is unchanged. Retry this public view to reconstruct the chronology.
          </p>
        </header>
        <div className={styles.errorPanel}>
          <ErrorState
            title="Unable to load The Timeline"
            description="This failed load did not change any account or workspace data. Check your connection, then try again."
            error={error}
            reset={reset}
          />
        </div>
      </section>
    </LandingRecoveryShell>
  );
}
