import { RelativeTimestamp } from '@/components/relative-timestamp';

export function McpOutboundKeyMeta({
  prefix,
  createdAt,
  lastUsedAt,
}: {
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1">
      <span>{prefix}…</span>
      <RelativeTimestamp prefix="created" value={createdAt} />
      {lastUsedAt ? (
        <RelativeTimestamp prefix="last used" value={lastUsedAt} />
      ) : (
        <span>never used</span>
      )}
    </span>
  );
}
