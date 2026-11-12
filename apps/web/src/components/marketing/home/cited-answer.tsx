'use client';
import { useRef, useState } from 'react';

import styles from '@/app/(landing)/home.module.css';
import { PUBLIC_DEMO_STORY } from '@/components/marketing/public-demo-story';
const ACME_EVENTS = PUBLIC_DEMO_STORY.landing.events;
export function CitedAnswer() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState<(typeof ACME_EVENTS)[number]>(ACME_EVENTS[0]);
  function showSource(id: string) {
    const event = ACME_EVENTS.find((event) => event.id === id);
    if (!event) return;
    setSelected(event);
    dialog.current?.showModal();
  }
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
            <Citation onSelect={showSource} id="01" label="Telegram group message" />. Onboarding
            copy was approved <Citation onSelect={showSource} id="02" label="Slack approval" /> and
            the migration callback merged{' '}
            <Citation onSelect={showSource} id="04" label="GitHub pull request" />. SSO remains the
            launch blocker <Citation onSelect={showSource} id="03" label="launch review meeting" />.
            Priya Shah owns the migration checklist and its Friday review{' '}
            <Citation onSelect={showSource} id="05" label="Timeline Document Drive checklist" />.
          </p>
        </div>
        <div className={styles.answerFooter}>
          <span>Select a reference to read its source.</span>
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
              <button type="button" onClick={() => { showSource(event.id); }} aria-haspopup="dialog">
                <span>[{event.id}]</span>
                <strong>{event.title}</strong>
                <small>
                  {event.shortSource} / {event.day} {event.time}
                </small>
              </button>
            </li>
          ))}
        </ol>
      </aside>
      <dialog ref={dialog} className={styles.sourcePreview} aria-labelledby="source-preview-title">
        <form method="dialog">
          <button className={styles.sourceClose} type="submit">
            Close source
          </button>
        </form>
        <p className={styles.monoLabel}>
          {selected.shortSource} / {selected.day} {selected.time}
        </p>
        <h3 id="source-preview-title">{selected.title}</h3>
        <p>{selected.detail}</p>
      </dialog>
    </div>
  );
}
function Citation({
  id,
  label,
  onSelect,
}: {
  id: string;
  label: string;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => { onSelect(id); }}
      aria-haspopup="dialog"
      className={styles.citation}
    >
      <span aria-hidden="true">[{id}]</span>
      <span className="sr-only">
        Source {id}: {label}
      </span>
    </button>
  );
}
