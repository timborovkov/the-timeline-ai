import Link from 'next/link';

import { EditorialStructuredData } from '@/components/marketing/editorial/editorial-structured-data';
import { FEATURE_GROUPS, FEATURES_DOCUMENT } from '@/components/marketing/features-content';
import { MarketingContainer } from '@/components/marketing/marketing-layout';
import { MarketingCtaBand } from '@/components/marketing/start-free-cta';
import { PublicShell } from '@/components/public-shell';
import { buildPublicStructuredData, metadataForPublicDocument } from '@/lib/public-site';
import { getSiteUrl } from '@/lib/site-url';

export const metadata = metadataForPublicDocument(FEATURES_DOCUMENT);

export default function FeaturesPage() {
  return (
    <PublicShell width="expanded" currentSection="features">
      <EditorialStructuredData data={buildPublicStructuredData(FEATURES_DOCUMENT, getSiteUrl())} />
      <main id="main" tabIndex={-1}>
        <MarketingContainer className="py-16 sm:py-24">
          <h1 className="text-5xl font-semibold tracking-tight sm:text-6xl">Features</h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-fg-muted">
            Ask a question, read an update or open a view. Each starts from the same shared work
            record.
          </p>
          {FEATURE_GROUPS.map((group) => (
            <section key={group.title} className="mt-12 border-t border-border pt-8">
              <h2 className="text-2xl font-semibold tracking-tight">{group.title}</h2>
              <ul className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {group.items.map((item) => (
                  <li key={item.title}>
                    <Link
                      href={item.href}
                      className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4"
                    >
                      {item.title}
                    </Link>
                    <p className="max-w-sm text-sm leading-relaxed text-fg-muted">{item.body}</p>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <Link
            href="/use-cases"
            className="mt-10 inline-flex min-h-11 items-center font-semibold underline underline-offset-4"
          >
            Explore use cases
          </Link>
        </MarketingContainer>
        <MarketingCtaBand
          title="Start with one source."
          body="Connect work your team already does, then ask a question you’d usually have to chase down."
        />
      </main>
    </PublicShell>
  );
}
