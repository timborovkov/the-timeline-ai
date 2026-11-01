import { ChevronRight } from 'lucide-react';
import Link from 'next/link';

import type { EditorialGuide } from '@/components/marketing/editorial/content';

import { HOW_IT_WORKS_ROUTE } from '@/components/marketing/editorial/content';
import { DirectAnswer } from '@/components/marketing/editorial/direct-answer';
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
                  href={HOW_IT_WORKS_ROUTE}
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
              <EditorialKicker>Walkthrough</EditorialKicker>
              <h1 className={`${styles.guideTitle} mt-6`}>{guide.title}</h1>
              <p className="mt-7 max-w-2xl text-lg leading-8 text-fg-muted sm:text-xl">
                {guide.summary}
              </p>
              <div className="mt-8 flex flex-wrap gap-2" aria-label="Sources in this walkthrough">
                {guide.nativeConnectors.map((connectorName) => {
                  const connector = findConnectorByName(connectorName);
                  return connector ? (
                    <Link
                      key={connectorName}
                      href={`/integrations/${connector.slug}`}
                      className="inline-flex min-h-10 items-center border border-border bg-surface px-3 font-mono text-[0.65rem] tracking-[0.1em] text-fg-muted uppercase outline-none hover:border-border-strong hover:text-fg focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      {connectorName}
                    </Link>
                  ) : null;
                })}
              </div>
            </div>
            <DirectAnswer answer={guide.answer} />
          </div>
        </header>

        <GuideMethodSections guide={guide} />
        <GuideClosingSections guide={guide} />
      </article>
    </main>
  );
}
