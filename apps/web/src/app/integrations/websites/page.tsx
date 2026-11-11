import { ArrowRight, CalendarClock, History, Quote } from 'lucide-react';
import Link from 'next/link';

import { WEBSITES_PUBLIC_DOCUMENT } from '@/components/marketing/integrations/connector-public-documents';
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
        <MarketingContainer className="py-16 sm:py-24">
          <div className="grid items-end gap-10 lg:grid-cols-[1.4fr_1fr] lg:gap-20">
            <div>
              <p className="mb-6 text-sm text-fg-muted">Sources / Websites</p>
              <h1 className="max-w-[14ch] text-4xl font-semibold tracking-tight sm:text-6xl">
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
            <div className="border-y border-border py-8">
              <p className="text-sm text-fg-muted">A five-page scan</p>
              <p className="mt-2 text-5xl font-semibold tracking-tight">€0.05</p>
              <p className="mt-3 text-sm text-fg-muted">
                100 source units, before allowances. AI and storage extra.
              </p>
              <Link
                href="/pricing#estimate-usage"
                className="mt-6 inline-flex items-center gap-2 text-sm underline underline-offset-4"
              >
                Estimate your usage
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            </div>
          </div>
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
