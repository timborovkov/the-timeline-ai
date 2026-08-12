import { ArrowRight, Check, CircleDotDashed, Wrench } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';

import {
  CONNECTOR_DIRECTORY_SUMMARY,
  CONNECTORS,
} from '@/components/marketing/integrations/connector-content';
import { DirectoryStructuredData } from '@/components/marketing/integrations/connector-seo';
import { RecordsToAnswer } from '@/components/marketing/integrations/records-to-answer';
import { PublicShell } from '@/components/public-shell';
import { Button } from '@/components/ui/button';

export function IntegrationDirectory({ isSignedIn }: { isSignedIn: boolean }) {
  const featuredConnector = CONNECTORS.find((connector) => connector.slug === 'slack');
  if (!featuredConnector) throw new Error('Native Slack connector content is required');

  return (
    <PublicShell isSignedIn={isSignedIn} footerLabel="The Timeline integrations">
      <DirectoryStructuredData />
      <main id="main" tabIndex={-1}>
        <section className="border-b border-border">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24 lg:py-28">
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg-dim">
              Integrations / capability directory
            </p>
            <div className="mt-8 grid items-end gap-10 lg:grid-cols-[1.25fr_0.75fr]">
              <h1 className="max-w-[13ch] text-[2.8rem] font-semibold leading-[0.98] tracking-[-0.055em] text-fg sm:text-6xl lg:text-7xl">
                Connect the systems where the work already happened.
              </h1>
              <div>
                <p className="max-w-[44ch] text-base leading-relaxed text-fg-muted sm:text-lg">
                  Native integrations turn selected records into chronological evidence. Timeline
                  can then answer across tools without blurring what each source actually does.
                </p>
                <Button asChild size="lg" className="mt-7">
                  <Link href={isSignedIn ? '/app/team/integrations' : '/sign-up'}>
                    {isSignedIn ? 'Open integrations' : 'Create your Timeline'}
                    <ArrowRight aria-hidden="true" />
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20" aria-labelledby="native">
          <div className="grid gap-8 lg:grid-cols-[0.45fr_1fr]">
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg-dim">
              01 / Native
            </p>
            <div>
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <h2 id="native" className="text-3xl font-semibold tracking-tight sm:text-4xl">
                    Six first-party ingestion paths
                  </h2>
                  <p className="mt-4 max-w-[62ch] text-base leading-relaxed text-fg-muted">
                    These connectors create durable, citable Timeline events from sources your team
                    explicitly selects.
                  </p>
                </div>
                <span className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.1em] text-fg-muted">
                  <span className="size-2 rounded-full bg-signal" aria-hidden="true" />
                  Available now
                </span>
              </div>
              <div className="mt-10 grid gap-px border border-border bg-border md:grid-cols-2">
                {CONNECTORS.map((connector, index) => (
                  <Link
                    key={connector.slug}
                    href={`/integrations/${connector.slug}`}
                    className="group flex min-h-64 flex-col bg-bg p-6 outline-none transition-colors hover:bg-surface focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:p-8"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="grid size-12 place-items-center rounded-md border border-border bg-surface">
                        <Image
                          src={connector.logo}
                          alt=""
                          width={30}
                          height={30}
                          className="size-7"
                        />
                      </div>
                      <span className="font-mono text-[11px] text-fg-dim">0{index + 1}</span>
                    </div>
                    <h3 className="mt-8 text-2xl font-semibold tracking-tight text-fg">
                      {connector.name}
                    </h3>
                    <p className="mt-3 grow text-sm leading-relaxed text-fg-muted">
                      {connector.intro}
                    </p>
                    <span className="mt-7 flex items-center gap-2 text-sm font-semibold text-fg">
                      See records become answers
                      <ArrowRight
                        aria-hidden="true"
                        className="size-4 transition-transform group-hover:translate-x-1"
                      />
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="border-y border-border bg-surface">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <div className="grid gap-8 lg:grid-cols-[0.45fr_1fr]">
              <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg-dim">
                02 / Proof
              </p>
              <div>
                <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                  Every connector has a specific evidence story.
                </h2>
                <p className="mt-4 max-w-[64ch] text-base leading-relaxed text-fg-muted">
                  Shared structure keeps the experience coherent. Provider-specific records,
                  questions, scenarios, permissions, and limitations keep the pages useful.
                </p>
                <div className="mt-10">
                  <RecordsToAnswer connector={featuredConnector} compact />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20" aria-labelledby="tiers">
          <div className="grid gap-8 lg:grid-cols-[0.45fr_1fr]">
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg-dim">
              03 / Tiers
            </p>
            <div>
              <h2 id="tiers" className="text-3xl font-semibold tracking-tight sm:text-4xl">
                Capability is not a marketing synonym.
              </h2>
              <p className="mt-4 max-w-[64ch] text-base leading-relaxed text-fg-muted">
                Native ingestion, live MCP access, and planned support are different capabilities.
                This directory names each tier and publishes detailed pages only for the six native
                integrations.
              </p>
              <div className="mt-10 border-t border-border">
                <CapabilityRow
                  icon={Check}
                  title="Native ingestion"
                  status="Indexable"
                  body={CONNECTORS.map((connector) => connector.name).join(', ')}
                  live
                />
                <CapabilityRow
                  icon={Wrench}
                  title="MCP access"
                  status="Live tools, not passive ingestion"
                  body={CONNECTOR_DIRECTORY_SUMMARY.mcpAccess.join(', ')}
                />
                <CapabilityRow
                  icon={CircleDotDashed}
                  title="Planned connectors"
                  status="Noindex"
                  body="Disclosed as future capability without thin, indexable connector pages."
                />
              </div>
            </div>
          </div>
        </section>
      </main>
    </PublicShell>
  );
}

function CapabilityRow({
  icon: Icon,
  title,
  status,
  body,
  live = false,
}: {
  icon: typeof Check;
  title: string;
  status: string;
  body: string;
  live?: boolean;
}) {
  return (
    <article className="grid gap-4 border-b border-border py-6 sm:grid-cols-[2rem_11rem_1fr_auto] sm:items-center">
      <Icon aria-hidden="true" className={live ? 'size-4 text-signal' : 'size-4 text-fg-dim'} />
      <h3 className="font-semibold text-fg">{title}</h3>
      <p className="text-sm leading-relaxed text-fg-muted">{body}</p>
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-fg-dim">
        {status}
      </span>
    </article>
  );
}
