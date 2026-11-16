import { ArrowDown, Link2 } from 'lucide-react';

import styles from '@/components/marketing/agents/agent-loop-diagram.module.css';
import { MotionFigure } from '@/components/marketing/motion-figure';

export function AgentLoopDiagram() {
  return (
    <MotionFigure className={styles.figure} data-agent-loop aria-labelledby="agent-loop-title">
      <h2 id="agent-loop-title">Context goes in. Progress comes back.</h2>
      <p className={styles.subject}>Acme rollout · Illustrative example</p>
      <section className={styles.read} aria-labelledby="agent-loop-read">
        <h3 id="agent-loop-read">Agents read Timeline</h3>
        <dl>
          <div>
            <dt>Decision</dt>
            <dd>Start with the beta cohort.</dd>
          </div>
          <div>
            <dt>Owner</dt>
            <dd>Priya owns the migration checklist.</dd>
          </div>
          <div>
            <dt>Sources</dt>
            <dd>Launch review, team thread and checklist.</dd>
          </div>
        </dl>
      </section>
      <div className={styles.transfer} aria-hidden="true">
        <span />
        <ArrowDown size={18} />
      </div>
      <section className={styles.write} aria-labelledby="agent-loop-write">
        <h3 id="agent-loop-write">Agents write into Timeline</h3>
        <blockquote>“Checked the migration callback. Ready for Priya’s review.”</blockquote>
        <p>
          <Link2 size={16} aria-hidden="true" /> Agent progress note · Source attached
        </p>
      </section>
      <figcaption>A note adds evidence. Lasting record changes still wait for approval.</figcaption>
    </MotionFigure>
  );
}
