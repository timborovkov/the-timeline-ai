import type { ConnectorContent } from '@/components/marketing/integrations/connector-content';

import {
  connectorStructuredData,
  directoryStructuredData,
  stringifyStructuredData,
} from '@/components/marketing/integrations/connector-structured-data';

export function ConnectorStructuredData({ connector }: { connector: ConnectorContent }) {
  return <StructuredData value={connectorStructuredData(connector)} />;
}

export function DirectoryStructuredData() {
  return <StructuredData value={directoryStructuredData()} />;
}

function StructuredData({ value }: { value: unknown }) {
  return (
    // react-doctor-disable-next-line react-doctor/no-danger, react-doctor/dangerous-html-sink
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: stringifyStructuredData(value) }}
    />
  );
}
