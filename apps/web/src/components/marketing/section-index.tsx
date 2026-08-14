export function MarketingSectionIndex({ index, label }: { index?: string; label: string }) {
  if (!index) return <p className="text-sm font-medium text-fg-muted">{label}</p>;

  return (
    <p className="flex items-baseline gap-1.5 text-sm font-medium text-fg-muted">
      <span className="font-mono text-[11px] text-fg-dim">{index}</span>
      <span aria-hidden="true">/</span>
      <span>{label}</span>
    </p>
  );
}
