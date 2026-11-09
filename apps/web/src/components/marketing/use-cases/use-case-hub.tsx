import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

import { EditorialKicker } from '@/components/marketing/editorial/editorial-kicker';
import { EditorialStructuredData } from '@/components/marketing/editorial/editorial-structured-data';
import styles from '@/components/marketing/editorial/editorial.module.css';
import { MarketingContainer } from '@/components/marketing/marketing-layout';
import { MarketingCtaBand } from '@/components/marketing/start-free-cta';
import { USE_CASE_HUB, USE_CASES } from '@/components/marketing/use-cases/content';
import { USE_CASE_PUBLIC_DOCUMENTS } from '@/components/marketing/use-cases/public-documents';
import { RecordJobsDiagram } from '@/components/marketing/use-cases/record-jobs-diagram';
import { buildPublicStructuredData } from '@/lib/public-site';
import { getSiteUrl } from '@/lib/site-url';

function getHubDocument() {
  const document = USE_CASE_PUBLIC_DOCUMENTS.documents.find(
    (candidate) => candidate.canonicalPath === USE_CASE_HUB.route,
  );
  if (!document) throw new Error('The public document registry is missing the use-cases hub');
  return document;
}

const hubDocument = getHubDocument();

export function UseCaseHubPage() {
  return (
    <main id="main" tabIndex={-1} data-use-cases-hub>
      <EditorialStructuredData data={buildPublicStructuredData(hubDocument, getSiteUrl())} />
      <header className="border-b border-border">
        <MarketingContainer className="py-16 sm:py-24 lg:py-28">
          <EditorialKicker>Use cases</EditorialKicker>
          <h1 className={`${styles.displayTitle} mt-6`}>{USE_CASE_HUB.title}</h1>
          <p className="mt-7 max-w-2xl text-lg leading-8 text-fg-muted sm:text-xl">
            {USE_CASE_HUB.summary}
          </p>
        </MarketingContainer>
      </header>

      <section className="border-b border-border">
        <MarketingContainer className="py-12 sm:py-16">
          <RecordJobsDiagram />
        </MarketingContainer>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <div className="grid gap-px bg-border sm:grid-cols-2">
          {USE_CASES.map((useCase, index) => (
            <Link
              key={useCase.route}
              href={useCase.route}
              className="group flex flex-col bg-bg p-6 outline-none hover:bg-surface focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:p-8"
            >
              <span className="font-mono text-[0.65rem] tracking-[0.14em] text-signal uppercase">
                {String(index + 1).padStart(2, '0')}
              </span>
              <h2 className="mt-5 text-2xl font-semibold tracking-[-0.035em]">
                {useCase.cardTitle}
              </h2>
              <p className="mt-3 grow text-sm leading-7 text-fg-muted">{useCase.cardBody}</p>
              <span className="mt-6 inline-flex items-center gap-2 text-sm font-medium">
                Open use case
                <ArrowRight
                  aria-hidden="true"
                  className="size-4 motion-safe:transition-transform motion-safe:group-hover:translate-x-1"
                />
              </span>
            </Link>
          ))}
        </div>
      </section>

      <MarketingCtaBand
        title="Link one channel. Watch the record fill in."
        body="Start with one Slack channel or Telegram group. The Timeline keeps the work record current from those conversations."
      />
    </main>
  );
}
