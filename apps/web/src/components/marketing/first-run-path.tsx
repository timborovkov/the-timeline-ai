import { FIRST_RUN_NOTE, FIRST_RUN_STEPS } from '@/components/marketing/copy';
import styles from '@/components/marketing/first-run-path.module.css';
import { PublicSessionBranch } from '@/components/public-session-branch';
import { cn } from '@/lib/utils';

export function FirstRunPath({
  compact = false,
  className,
  showNote = true,
}: {
  compact?: boolean;
  className?: string;
  showNote?: boolean;
}) {
  return (
    <PublicSessionBranch
      signedOut={
        <div
          className={cn('w-full max-w-[36rem]', compact && styles.compact, className)}
          data-first-run={compact ? 'compact' : 'full'}
        >
          <ol className={styles.list} aria-label="What you do after signup">
            {FIRST_RUN_STEPS.map((step) => (
              <li key={step.index} className={styles.item}>
                <span className={styles.index} aria-hidden="true">
                  {step.index}
                </span>
                <div className={styles.copy}>
                  <p className={styles.title}>{step.title}</p>
                  <p className={styles.detail}>{step.detail}</p>
                </div>
              </li>
            ))}
          </ol>
          {showNote ? <p className={styles.note}>{FIRST_RUN_NOTE}</p> : null}
        </div>
      }
      signedIn={null}
    />
  );
}
