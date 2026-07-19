export function ActionChip({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className="inline-flex items-center gap-1 rounded-sm border border-border bg-surface px-2 py-1 text-xs font-medium text-fg-muted hover:border-signal hover:text-signal"
    >
      {label}
    </a>
  );
}
