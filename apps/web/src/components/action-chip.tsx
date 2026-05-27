export function ActionChip({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className="inline-flex items-center gap-1 rounded-sm border border-border bg-surface px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-fg-muted hover:border-signal hover:text-signal"
    >
      {label}
    </a>
  );
}
