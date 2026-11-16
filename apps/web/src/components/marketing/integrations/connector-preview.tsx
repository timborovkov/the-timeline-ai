import { GitMerge } from 'lucide-react';

import type { ConnectorContent } from '@/components/marketing/integrations/connector-content';

import styles from '@/components/marketing/integrations/integration-detail.module.css';
import { IntegrationSourceFeed } from '@/components/marketing/integrations/integration-source-feed';

export function ConnectorPreview({ connector }: { connector: ConnectorContent }) {
  return (
    <figure className={styles.preview}>
      <div className={styles.previewHeader}>
        <p>{connector.name}, in the work record</p>
        <GitMerge size={22} aria-hidden="true" />
      </div>
      <IntegrationSourceFeed records={connector.diagram.records} />
      <div className={styles.result}>
        <h2>The context comes together.</h2>
        <p>{connector.diagram.answer}</p>
      </div>
      <figcaption>
        Illustrative example · Sources attached. Inferred record changes require approval.
      </figcaption>
    </figure>
  );
}
