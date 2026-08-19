export function ActionChip({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className="inline-flex items-center rounded-sm px-2 py-1 text-xs text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
    >
      {label}
    </a>
  );
}
