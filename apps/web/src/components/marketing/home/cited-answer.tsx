import styles from '@/app/(landing)/home.module.css';
import { PUBLIC_DEMO_STORY } from '@/components/marketing/public-demo-story';
const ACME_EVENTS = PUBLIC_DEMO_STORY.landing.events;
export function CitedAnswer() {
  return (
    <div className={styles.answerLayout} data-home-diagram>
      <article className={styles.answerWindow}>
        <div className={styles.answerBar}>
          <span>/ask / Acme rollout</span>
          <span>5 sources linked</span>
        </div>
        <div className={styles.question}>
          <span>You</span>
          <p>Give me the current status, handoff, blockers, and customer commitments.</p>
        </div>
        <div className={styles.answerBody}>
          <span>Timeline</span>
          <h3>SSO blocks launch. Friday’s customer update is still due.</h3>
          <p>
            The customer expects an update by Friday{' '}
            <Citation id="01" label="Telegram group message" />. Onboarding copy was approved{' '}
            <Citation id="02" label="Slack approval" /> and the migration callback merged{' '}
            <Citation id="04" label="GitHub pull request" />. SSO remains the launch blocker{' '}
            <Citation id="03" label="launch review meeting" />. Priya Shah owns the migration
            checklist and its Friday review{' '}
            <Citation id="05" label="Timeline Document Drive checklist" />.
          </p>
        </div>
        <div className={styles.answerFooter}>
          <span>Each numbered reference matches a source shown here.</span>
        </div>
      </article>

      <aside className={styles.receiptLedger} aria-labelledby="receipt-ledger-title">
        <header className={styles.ledgerTitle}>
          <span id="receipt-ledger-title">Sources behind this answer</span>
          <span>5 sources</span>
        </header>
        <ol>
          {ACME_EVENTS.map((event) => (
            <li key={event.id}>
              <div className={styles.sourceCard}>
                <span>[{event.id}]</span>
                <strong>{event.title}</strong>
                <small>
                  {event.shortSource} / {event.day} {event.time}
                </small>
                <p>{event.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      </aside>
    </div>
  );
}
function Citation({ id, label }: { id: string; label: string }) {
  return (
    <span className={styles.citation}>
      <span aria-hidden="true">[{id}]</span>
      <span className="sr-only">
        Source {id}: {label}
      </span>
    </span>
  );
}
