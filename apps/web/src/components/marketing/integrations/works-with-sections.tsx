import type { WorksWithTool } from '@/components/marketing/integrations/works-with-content';

import styles from '@/components/marketing/integrations/integration-detail.module.css';

export function WorksWithGuidance({ tool }: { tool: WorksWithTool }) {
  return (
    <section className={styles.section} aria-label={`Choosing how to use ${tool.name}`}>
      <div className={styles.split}>
        <div>
          <h2>Start with the work you need to keep.</h2>
          <p className={styles.statement}>{tool.gettingStarted}</p>
        </div>
        <div>
          <h2>When {tool.name} is enough.</h2>
          <p className={styles.statement}>{tool.whenAloneBetter}</p>
        </div>
      </div>
    </section>
  );
}
