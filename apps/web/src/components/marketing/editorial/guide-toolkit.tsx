import Link from 'next/link';

import type { EditorialGuide } from '@/components/marketing/editorial/content';

export function GuideToolkit({ toolkit }: { toolkit: NonNullable<EditorialGuide['toolkit']> }) {
  return (
    <section className="mx-auto max-w-6xl px-4 pb-14 sm:px-6 sm:pb-20" aria-label={toolkit.title}>
      <h2 className="text-3xl font-semibold tracking-tight">{toolkit.title}</h2>
      <p className="mt-5 max-w-3xl text-base leading-7 text-fg-muted">{toolkit.introduction}</p>
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <div className="min-w-0 rounded-md border border-border p-6">
          <h3 className="text-xl font-semibold">Reusable template</h3>
          <p className="mt-3 text-sm text-fg-muted">
            Select and copy the text below into your own document.
          </p>
          <pre className="mt-5 whitespace-pre-wrap break-words font-mono text-sm leading-7">
            {toolkit.template}
          </pre>
        </div>
        <div className="min-w-0 rounded-md border border-border p-6">
          <h3 className="text-xl font-semibold">Worked example · fictional</h3>
          <pre className="mt-5 whitespace-pre-wrap break-words font-mono text-sm leading-7">
            {toolkit.example}
          </pre>
        </div>
      </div>
      <nav aria-label="Setup and reference links" className="mt-7">
        <ul className="flex flex-wrap gap-x-6 gap-y-3">
          {toolkit.links.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="inline-flex min-h-11 items-center text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </section>
  );
}
