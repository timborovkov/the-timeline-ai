import { RegionalDate } from '@/components/regional-date';

export function SharedRecordDetails({
  record,
}: {
  record: { live: boolean; body: string | null; status: string | null; dueDate: string | null };
}) {
  if (!record.live) return <p className="whitespace-pre-wrap break-words">{record.body}</p>;
  return (
    <dl className="space-y-2 text-sm">
      {record.status ? (
        <div className="flex gap-2">
          <dt>Status</dt>
          <dd>{record.status}</dd>
        </div>
      ) : null}
      {record.dueDate ? (
        <div className="flex gap-2">
          <dt>Due</dt>
          <dd>
            <RegionalDate value={record.dueDate} variant="datetime" />
          </dd>
        </div>
      ) : null}
      <div className="text-muted-foreground">
        <dt className="sr-only">Field visibility</dt>
        <dd>Fields may be omitted when unset or unsupported by team-visible evidence.</dd>
      </div>
    </dl>
  );
}
