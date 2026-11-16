import styles from '@/components/marketing/integrations/integration-detail.module.css';

export function IntegrationSourceFeed({
  records,
}: {
  records: readonly { time: string; label: string; detail: string }[];
}) {
  return (
    <ol className={styles.feed}>
      {records.map((record) => (
        <li key={`${record.time}-${record.label}`}>
          <span className="font-mono text-xs text-fg-muted pt-1">{record.time}</span>
          <div>
            <strong>{record.label}</strong>
            <p>{record.detail}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
