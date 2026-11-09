import Link from 'next/link';

import { MOCKUP_ROUTES } from '@/components/mockups/mockup-data';
import { MockupIndexChrome } from '@/components/mockups/mockup-shell';

export const metadata = {
  title: 'Mockup index',
  robots: { index: false, follow: false },
};

export default function MockupsIndexPage() {
  return (
    <MockupIndexChrome>
      <h1 className="text-2xl font-semibold tracking-tight text-fg">Visual mockups</h1>
      <p className="mt-2 max-w-[65ch] text-sm leading-[1.65] text-fg-muted">
        Clickable studies for how three ideas could feel in The Timeline. Hardcoded Acme Labs
        example data. Isolated from auth, APIs, schema, and live product routes. Do not merge.
      </p>
      <ul className="mt-8 divide-y divide-border border-y border-border">
        {MOCKUP_ROUTES.map((route) => (
          <li key={route.href}>
            <Link
              href={route.href}
              className="group flex items-start justify-between gap-4 py-4 transition-colors hover:bg-surface sm:px-3"
            >
              <span className="min-w-0">
                <span className="block text-sm font-medium text-fg">{route.title}</span>
                <span className="mt-1 block text-sm text-fg-muted">{route.description}</span>
                <span className="mt-1 block font-mono text-[11px] text-fg-dim">{route.href}</span>
              </span>
              <span className="shrink-0 text-xs text-fg-muted group-hover:text-fg">Open</span>
            </Link>
          </li>
        ))}
      </ul>
    </MockupIndexChrome>
  );
}
