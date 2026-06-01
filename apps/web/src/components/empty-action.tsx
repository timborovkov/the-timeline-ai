import Link from 'next/link';

export function EmptyAction({
  title,
  body,
  href,
  action,
}: {
  title: string;
  body: string;
  href: string;
  action: string;
}) {
  return (
    <div className="border-y border-border py-10 text-center">
      <p className="font-mono text-xs uppercase tracking-[0.12em] text-fg-dim">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-fg-muted">{body}</p>
      <Link
        href={href}
        className="mt-4 inline-flex min-h-9 items-center rounded-sm border border-signal/40 bg-signal-soft px-3 font-mono text-[11px] uppercase tracking-[0.12em] text-signal transition-colors hover:bg-signal/20"
      >
        {action}
      </Link>
    </div>
  );
}
