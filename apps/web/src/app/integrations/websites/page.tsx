import { ArrowRight, CalendarClock, History, Quote } from 'lucide-react';
import Link from 'next/link';

import { WEBSITES_PUBLIC_DOCUMENT } from '@/components/marketing/integrations/connector-public-documents';
import styles from '@/components/marketing/integrations/integration-detail.module.css';
import { IntegrationSourceFeed } from '@/components/marketing/integrations/integration-source-feed';
import { MarketingContainer } from '@/components/marketing/marketing-layout';
import { PublicShell } from '@/components/public-shell';
import { Button } from '@/components/ui/button';
import { metadataForPublicDocument } from '@/lib/public-site';

export const metadata = metadataForPublicDocument(WEBSITES_PUBLIC_DOCUMENT);

const benefits = [
  {
    icon: CalendarClock,
    title: 'Check in automatically',
    text: 'Scan on demand, or set a daily or weekly schedule when scheduling is enabled.',
  },
  {
    icon: History,
    title: 'See what changed',
    text: 'New captures join your timeline. Earlier versions and citations stay available.',
  },
  {
    icon: Quote,
    title: 'Ask with context',
    text: 'Your team’s answers use the latest ready pages, with citations back to the source.',
  },
];

export default function WebsiteIntegrationPage() {
  return (
    <PublicShell currentSection="integrations" footerLabel="Website sources">
      <main id="main" tabIndex={-1}>
        <MarketingContainer className={styles.hero}>
          <Link href="/integrations" className={styles.back}>
            All integrations
          </Link>
          <div className={styles.heroGrid}>
            <div>
              <h1 className={styles.title}>
                Websites change.
                <br />
                Keep the context.
              </h1>
              <p className="mt-6 max-w-lg text-lg leading-relaxed text-fg-muted">
                Follow your company’s website or another public site. Bring the changes into your
                team’s timeline.
              </p>
              <Button asChild size="lg" className="mt-8">
                <Link href="/app/connections/websites">
                  Add a website
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
            </div>
            <figure className={styles.preview}>
              <div className={styles.previewHeader}>
                <p>A website, over time.</p>
                <History size={22} aria-hidden="true" />
              </div>
              <IntegrationSourceFeed
                records={[
                  {
                    time: 'Mon',
                    label: 'Pricing page captured',
                    detail: 'The current public offer joins the timeline.',
                  },
                  {
                    time: 'Fri',
                    label: 'A new version captured',
                    detail:
                      'The latest ready page can be used in answers. Earlier captures stay available.',
                  },
                ]}
              />
              <div className={styles.result}>
                <h2>Keep the source behind the answer.</h2>
                <p>Inspect the captured page and its history when the live website has moved on.</p>
              </div>
              <figcaption>Illustrative example · Public website captures</figcaption>
            </figure>
          </div>
          <section
            className="mt-12 flex flex-wrap items-baseline justify-between gap-4 border-y border-border py-6"
            aria-label="Website scan pricing"
          >
            <p className="text-lg">
              A five-page scan: <strong>€0.05</strong>
            </p>
            <p className="text-sm text-fg-muted">
              100 source units, before allowances. AI and storage extra.
            </p>
            <Link
              href="/pricing#estimate-usage"
              className="py-2 text-sm underline underline-offset-4"
            >
              Estimate your usage
            </Link>
          </section>
          <div className="my-16 grid gap-8 border-y border-border py-8 sm:grid-cols-3">
            {benefits.map(({ icon: Icon, title, text }) => (
              <section key={title}>
                <Icon aria-hidden="true" className="mb-5 size-5 text-fg-muted" />
                <h2 className="text-lg font-semibold">{title}</h2>
                <p className="mt-2 max-w-sm text-sm leading-6 text-fg-muted">{text}</p>
              </section>
            ))}
          </div>
          <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
            <h2 className="text-2xl font-semibold tracking-tight">A few useful details</h2>
            <div className="divide-y border-y text-sm">
              <details className="py-5">
                <summary className="cursor-pointer font-medium focus-visible:outline-2">
                  What can I scan?
                </summary>
                <p className="mt-3 max-w-2xl leading-6 text-fg-muted">
                  Up to five public pages on the same site, with permission to submit them.
                  Login-protected pages aren’t supported. Captures are visible to your team;
                  suggested record changes still need approval.
                </p>
              </details>
              <details className="py-5">
                <summary className="cursor-pointer font-medium focus-visible:outline-2">
                  How do schedules and limits work?
                </summary>
                <p className="mt-3 max-w-2xl leading-6 text-fg-muted">
                  Members can scan on demand. Admins can set daily or weekly schedules in the team’s
                  timezone once scheduling is enabled, on every plan. Up to 100 websites per team,
                  one scan at a time, and at least an hour between scans of the same site. Billing
                  limits also apply.
                </p>
              </details>
              <details className="py-5">
                <summary className="cursor-pointer font-medium focus-visible:outline-2">
                  What counts toward usage?
                </summary>
                <p className="mt-3 max-w-2xl leading-6 text-fg-muted">
                  Each captured page uses 20 accepted-source units, including unchanged pages. AI
                  and storage are separate. Retrying processing on an existing capture doesn’t add
                  another scan charge.
                </p>
              </details>
              <details className="py-5">
                <summary className="cursor-pointer font-medium focus-visible:outline-2">
                  Can I scan from chat or an agent?
                </summary>
                <p className="mt-3 max-w-2xl leading-6 text-fg-muted">
                  Use <code>/crawl</code> in Telegram or <code>/timeline crawl</code> in Slack. Both
                  confirm permission and cost first. Scoped MCP and HTTP access are also available.
                </p>
              </details>
              <details className="py-5">
                <summary className="cursor-pointer font-medium focus-visible:outline-2">
                  What happens when I remove a website?
                </summary>
                <p className="mt-3 max-w-2xl leading-6 text-fg-muted">
                  Future scans stop; captured history stays. Firecrawl processes public page
                  content. Read our{' '}
                  <Link className="underline" href="/privacy">
                    Privacy Policy
                  </Link>{' '}
                  for provider retention and erasure details.
                </p>
              </details>
            </div>
          </div>
        </MarketingContainer>
      </main>
    </PublicShell>
  );
}
