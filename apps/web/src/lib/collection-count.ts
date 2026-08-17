export function formatCollectionCount({
  matching,
  total,
  filtered,
}: {
  matching: number;
  total: number;
  filtered: boolean;
}): string {
  if (!filtered) return String(total);
  return `${matching} of ${total}`;
}
