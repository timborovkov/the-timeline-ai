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
      <p className="text-sm font-semibold text-fg">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-fg-muted">{body}</p>
      <Link
        href={href}
        className="mt-4 inline-flex min-h-9 items-center rounded-sm border border-border px-3 text-sm font-medium text-fg transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-2 focus-visible:ring-offset-bg forced-colors:focus-visible:outline forced-colors:focus-visible:outline-2"
      >
        {action}
      </Link>
    </div>
  );
}
