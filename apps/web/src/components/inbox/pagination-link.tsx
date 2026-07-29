import Link from 'next/link';

export function InboxPaginationLink({
  children,
  disabled,
  href,
}: {
  children: string;
  disabled: boolean;
  href: string;
}) {
  const className =
    'inline-flex min-h-9 items-center rounded-sm border px-2.5 text-sm transition-colors';

  if (disabled) {
    return (
      <span aria-disabled="true" className={`${className} border-border text-fg-dim opacity-45`}>
        {children}
      </span>
    );
  }

  return (
    <Link
      href={href}
      className={`${className} border-border text-fg-muted hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-2 focus-visible:ring-offset-bg`}
    >
      {children}
    </Link>
  );
}
