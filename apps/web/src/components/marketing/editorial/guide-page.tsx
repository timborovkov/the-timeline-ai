import { Check, ChevronRight } from 'lucide-react';
import Link from 'next/link';

import type { EditorialGuide } from '@/components/marketing/editorial/content';

import { RECORD_ROUTE } from '@/components/marketing/editorial/content';
import { EditorialKicker } from '@/components/marketing/editorial/editorial-kicker';
import styles from '@/components/marketing/editorial/editorial.module.css';
import { GuideClosingSections } from '@/components/marketing/editorial/guide-closing-sections';
import { GuideMethodSections } from '@/components/marketing/editorial/guide-method-sections';
import { findConnectorByName } from '@/components/marketing/integrations/connector-content';

export function EditorialGuidePage({ guide }: { guide: EditorialGuide }) {
  return (
    <main id="main" tabIndex={-1}>
      <article>
        <header className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
          <nav aria-label="Breadcrumb" className="mb-9">
            <ol className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
              <li>
                <Link
                  href="/"
                  className="rounded-sm outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  Timeline
                </Link>
              </li>
              <li aria-hidden="true">
                <ChevronRight className="size-3.5" />
              </li>
              <li>
                <Link
                  href={RECORD_ROUTE}
                  className="rounded-sm outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  How it works
                </Link>
              </li>
              <li aria-hidden="true">
                <ChevronRight className="size-3.5" />
              </li>
              <li aria-current="page" className="text-fg">
                {guide.shortTitle}
              </li>
            </ol>
          </nav>
          <div className={styles.heroGrid}>
            <div>
              <EditorialKicker>Walkthrough / {guide.nativeConnectors.join(' + ')}</EditorialKicker>
              <h1 className={`${styles.guideTitle} mt-6`}>{guide.title}</h1>
              <p className="mt-7 max-w-2xl text-lg leading-8 text-fg-muted sm:text-xl">
                {guide.summary}
              </p>
              <div className="mt-8 flex flex-wrap gap-2" aria-label="Native sources covered">
                {guide.nativeConnectors.map((connectorName) => {
                  const connector = findConnectorByName(connectorName);
                  return connector ? (
                    <Link
                      key={connectorName}
                      href={`/integrations/${connector.slug}`}
                      className="inline-flex min-h-10 items-center border border-border bg-surface px-3 font-mono text-[0.65rem] tracking-[0.1em] text-fg-muted uppercase outline-none hover:border-border-strong hover:text-fg focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      Native / {connectorName}
                    </Link>
                  ) : null;
                })}
              </div>
            </div>
            <aside
              aria-label="Direct answer"
              className={`${styles.indexRule} border-y border-border py-8 pl-7 sm:pl-9`}
            >
              <p className="font-mono text-[0.68rem] tracking-[0.14em] text-signal uppercase">
                Start with the answer
              </p>
              <h2 className="mt-5 text-balance text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">
                {guide.answer.title}
              </h2>
              <p className="mt-5 text-base leading-7 text-fg-muted">{guide.answer.body}</p>
              <ul className="mt-7 grid gap-3">
                {guide.answer.checklist.map((item) => (
                  <li key={item} className="grid grid-cols-[1rem_1fr] gap-3 text-sm leading-6">
                    <Check aria-hidden="true" className="mt-1 size-4 text-signal" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </aside>
          </div>
        </header>

        <GuideMethodSections guide={guide} />
        <GuideClosingSections guide={guide} />
      </article>
    </main>
  );
}
