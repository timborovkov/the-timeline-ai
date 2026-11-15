import Link from 'next/link';

import {
  EDITORIAL_GUIDES,
  GUIDES_ROUTE,
  HOW_IT_WORKS_ROUTE,
} from '@/components/marketing/editorial/content';
import { EditorialStructuredData } from '@/components/marketing/editorial/editorial-structured-data';
import {
  buildGuidesStructuredData,
  createGuidesMetadata,
} from '@/components/marketing/editorial/metadata';
import { findEditorialPublicDocument } from '@/components/marketing/editorial/public-documents';

export const metadata = createGuidesMetadata();

const reviewDateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

export default function GuidesPage() {
  const document = findEditorialPublicDocument(GUIDES_ROUTE);
  return (
    <>
      <EditorialStructuredData data={buildGuidesStructuredData()} />
      <main id="main" tabIndex={-1} className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
        <nav aria-label="Breadcrumb" className="mb-9 text-sm text-fg-muted">
          <ol className="flex flex-wrap items-center gap-3">
            <li>
              <Link href="/" className="underline underline-offset-4">
                Home
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li aria-current="page">Guides</li>
          </ol>
        </nav>
        <header className="max-w-3xl">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-6xl">{document.title}</h1>
          <p className="mt-7 text-lg leading-8 text-fg-muted">{document.description}</p>
          <p className="mt-5 leading-7 text-fg-muted">
            New to The Timeline?{' '}
            <Link href={HOW_IT_WORKS_ROUTE} className="text-fg underline underline-offset-4">
              See how it works
            </Link>
            , then choose a workflow below.
          </p>
        </header>
        <section
          aria-label="Available guides"
          className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3"
        >
          {EDITORIAL_GUIDES.map((guide) => {
            const reviewed = findEditorialPublicDocument(guide.route).dates.reviewed;
            return (
              <article
                key={guide.route}
                className="flex flex-col rounded-md border border-border p-6 sm:p-8"
              >
                <p className="text-sm leading-6 text-fg-muted">
                  {guide.nativeConnectors.join(' + ')}
                </p>
                <h2 className="mt-4 text-2xl font-semibold tracking-tight">
                  <Link
                    href={guide.route}
                    className="rounded-sm underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    {guide.title}
                  </Link>
                </h2>
                <p className="mt-5 text-base leading-7 text-fg-muted">{guide.summary}</p>
                <p className="mt-auto pt-8 text-sm text-fg-muted">
                  Last reviewed{' '}
                  <time dateTime={reviewed}>
                    {reviewDateFormat.format(new Date(`${reviewed}T00:00:00Z`))}
                  </time>
                </p>
              </article>
            );
          })}
        </section>
      </main>
    </>
  );
}
