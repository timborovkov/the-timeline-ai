import styles from '@/app/(landing)/home.module.css';
import { PUBLIC_DEMO_STORY } from '@/components/marketing/public-demo-story';
const LOGIN_EVENTS = PUBLIC_DEMO_STORY.landing.events;
export function CitedAnswer() {
  return (
    <div className={styles.answerLayout} data-home-panel-motion>
      <article className={styles.answerWindow}>
        <div className={styles.answerBar}>
          <span>/ask / Login issue</span>
          <span>{LOGIN_EVENTS.length} sources linked</span>
        </div>
        <div className={styles.question}>
          <span>You</span>
          <p>What changed with the login issue, and what still needs checking?</p>
        </div>
        <div className={styles.answerBody}>
          <span>Timeline</span>
          <h3>A linked change merged. The customer outcome still needs checking.</h3>
          <p>
            Slack reported the login problem <Citation id="01" label="Slack report" />. Priya
            planned to investigate Friday <Citation id="02" label="rollout review meeting" />. The
            linked pull request merged <Citation id="03" label="GitHub pull request" />. Check
            whether the change shipped and whether the customer can log in.
          </p>
        </div>
        <div className={styles.answerFooter}>
          <span>Each numbered reference matches a source shown here.</span>
        </div>
      </article>

      <section className={styles.receiptLedger} aria-labelledby="receipt-ledger-title">
        <header className={styles.ledgerTitle}>
          <span id="receipt-ledger-title">Sources behind this answer</span>
          <span>{LOGIN_EVENTS.length} sources</span>
        </header>
        <ol>
          {LOGIN_EVENTS.map((event) => (
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
      </section>
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
