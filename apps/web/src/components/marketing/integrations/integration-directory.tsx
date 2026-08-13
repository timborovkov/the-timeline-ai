import { ArrowRight, Check, CircleDotDashed, Wrench } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';

import {
  CONNECTORS,
  getConnectorCapabilityTiers,
} from '@/components/marketing/integrations/connector-content';
import { DirectoryStructuredData } from '@/components/marketing/integrations/connector-seo';
import { RecordsToAnswer } from '@/components/marketing/integrations/records-to-answer';
import { PublicShell } from '@/components/public-shell';
import { Button } from '@/components/ui/button';

export function IntegrationDirectory({ isSignedIn }: { isSignedIn: boolean }) {
  const featuredConnector = CONNECTORS.find((connector) => connector.slug === 'slack');
  if (!featuredConnector) throw new Error('Native Slack connector content is required');
  const capabilityTiers = getConnectorCapabilityTiers();

  return (
    <PublicShell
      isSignedIn={isSignedIn}
      footerLabel="The Timeline integrations"
      currentSection="integrations"
    >
      <DirectoryStructuredData />
      <main id="main" tabIndex={-1}>
        <section className="border-b border-border">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24 lg:py-28">
            <p className="text-sm font-medium text-fg-muted">Integrations / capability directory</p>
            <div className="mt-8 grid items-end gap-10 lg:grid-cols-[1.25fr_0.75fr]">
              <h1 className="max-w-[13ch] break-words text-[4rem] font-semibold leading-[0.9] tracking-[-0.065em] text-fg sm:text-[clamp(4.5rem,7.5vw,7.5rem)]">
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
            <SectionLabel label="Native integrations" />
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
                <span className="inline-flex items-center gap-2 text-sm font-medium text-fg-muted">
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
                      <div
                        className={`grid size-12 place-items-center rounded-md border border-border bg-surface ${connector.lightLogoTileInDarkMode ? 'dark:bg-white' : ''}`}
                      >
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
              <SectionIndex index="02" label="Proof" />
              <div>
                <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                  Every connector has a specific evidence story.
                </h2>
                <p className="mt-4 max-w-[64ch] text-base leading-relaxed text-fg-muted">
                  Start with one operating question. Timeline orders selected records by time, keeps
                  their source attached, and cites the evidence used in the answer. This Slack
                  example shows that journey from conversation to chronology.
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
            <SectionLabel label="Capability tiers" />
            <div>
              <h2 id="tiers" className="text-3xl font-semibold tracking-tight sm:text-4xl">
                Know what each connection can do.
              </h2>
              <p className="mt-4 max-w-[64ch] text-base leading-relaxed text-fg-muted">
                Native integrations store selected evidence in Timeline. MCP connections provide
                live tool access without passive ingestion. Planned native support cannot be
                connected yet.
              </p>
              <div className="mt-10 border-t border-border">
                <CapabilityRow
                  icon={Check}
                  title="Native ingestion"
                  status="Available now"
                  body={capabilityTiers.nativeProviders.join(', ')}
                  live
                />
                <CapabilityRow
                  icon={Wrench}
                  title="MCP access"
                  status="Live access"
                  body={capabilityTiers.mcpAccess.join(', ')}
                />
                <CapabilityRow
                  icon={CircleDotDashed}
                  title="Planned native support"
                  status="Not available yet"
                  body={capabilityTiers.plannedProviders.join(', ')}
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
      <span className="text-xs font-medium text-fg-dim">{status}</span>
    </article>
  );
}

function SectionLabel({ label }: { label: string }) {
  return <p className="text-sm font-medium text-fg-muted">{label}</p>;
}

function SectionIndex({ index, label }: { index: string; label: string }) {
  return (
    <p className="flex items-baseline gap-1.5 text-sm font-medium text-fg-muted">
      <span className="font-mono text-[11px] text-fg-dim">{index}</span>
      <span aria-hidden="true">/</span>
      <span>{label}</span>
    </p>
  );
}
