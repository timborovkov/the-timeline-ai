import Link from 'next/link';

import type { Metadata } from 'next';

import { HELP_INDEX_GROUPS, HELP_PAGES } from '@/lib/help-content';
import { publicMetadata } from '@/lib/public-metadata';

export const metadata: Metadata = publicMetadata({
  title: 'Help',
  description: 'Public help docs for The Timeline.',
  path: '/help',
});

export default function HelpIndexPage() {
  return (
    <article className="space-y-10">
      <header className="max-w-3xl space-y-4">
        <p className="text-xs font-medium text-fg-muted">Help center</p>
        <h1 className="text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
          Use Timeline without needing a private tour.
        </h1>
        <p className="text-lg text-fg-muted">
          Public guides for capture, Work, documents, boards, integrations, and object management.
        </p>
      </header>

      <section className="grid gap-8 lg:grid-cols-2">
        {HELP_INDEX_GROUPS.map((group) => (
          <div key={group.title} className="space-y-3">
            <h2 className="text-base font-semibold text-fg">{group.title}</h2>
            <div className="divide-y divide-border border-y border-border">
              {group.items.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className="flex items-center gap-3 rounded-sm py-4 text-fg transition-colors hover:text-signal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg focus-visible:ring-offset-2 focus-visible:ring-offset-bg forced-colors:focus-visible:outline forced-colors:focus-visible:outline-2"
                >
                  <Icon className="size-5 text-fg-dim" />
                  <span className="text-lg font-medium">{label}</span>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="border-t border-border pt-8">
        <h2 className="mb-4 text-base font-semibold text-fg">All guides</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {HELP_PAGES.map((page) => (
            <Link
              key={page.slug}
              href={`/help/${page.slug}`}
              className="group rounded-sm border border-border p-4 transition-colors hover:border-signal/50 hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg focus-visible:ring-offset-2 focus-visible:ring-offset-bg forced-colors:focus-visible:outline forced-colors:focus-visible:outline-2"
            >
              <page.icon className="mb-4 size-5 text-signal" />
              <h3 className="text-lg font-semibold text-fg group-hover:text-signal">
                {page.title}
              </h3>
              <p className="mt-2 text-sm text-fg-muted">{page.description}</p>
            </Link>
          ))}
        </div>
      </section>
    </article>
  );
}
