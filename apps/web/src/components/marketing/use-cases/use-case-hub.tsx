import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

import { EditorialStructuredData } from '@/components/marketing/editorial/editorial-structured-data';
import { MarketingContainer } from '@/components/marketing/marketing-layout';
import { MarketingCtaBand } from '@/components/marketing/start-free-cta';
import { findUseCase, USE_CASE_HUB } from '@/components/marketing/use-cases/content';
import { USE_CASE_PUBLIC_DOCUMENTS } from '@/components/marketing/use-cases/public-documents';
import styles from '@/components/marketing/use-cases/use-case-hub.module.css';
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
const JOB_GROUPS = [
  { title: 'Understand what happened', slugs: ['work-record', 'communication-trail'] },
  { title: 'Keep work moving', slugs: ['crm', 'task-board'] },
  { title: 'Share the context', slugs: ['team-daily-log', 'onboarding-and-repeat-questions'] },
] as const;

export function UseCaseHubPage() {
  return (
    <main id="main" tabIndex={-1} data-use-cases-hub>
      <EditorialStructuredData data={buildPublicStructuredData(hubDocument, getSiteUrl())} />
      <header>
        <MarketingContainer className={styles.intro}>
          <h1 className={styles.title}>{USE_CASE_HUB.title}</h1>
          <p className={styles.summary}>{USE_CASE_HUB.summary}</p>
        </MarketingContainer>
      </header>

      <MarketingContainer className={styles.directory}>
        {JOB_GROUPS.map((group) => (
          <section key={group.title} className={styles.group} aria-label={group.title}>
            <h2>{group.title}</h2>
            <div className={styles.jobs}>
              {group.slugs.map((slug) => {
                const useCase = findUseCase(slug);
                if (!useCase) throw new Error(`Missing use case: ${slug}`);
                return (
                  <Link key={useCase.route} href={useCase.route} className={styles.job}>
                    <h3>{useCase.cardTitle}</h3>
                    <p>{useCase.cardBody}</p>
                    <ArrowRight aria-hidden="true" className="size-5" />
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
        <p className={styles.sharedRecord}>
          One work record, with source, time and visibility attached. Lasting changes wait for your
          approval.
        </p>
      </MarketingContainer>

      <MarketingCtaBand
        title="Link one channel. Watch the record fill in."
        body="Start with one Slack channel or Telegram group. The Timeline keeps the work record current from those conversations."
      />
    </main>
  );
}
