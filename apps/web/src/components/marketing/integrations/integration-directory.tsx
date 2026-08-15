import { ArrowRight, Check, CircleDotDashed, Mail, Video, Webhook, Wrench } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';

import {
  CAPTURE_SURFACES,
  type CaptureSurfaceContent,
} from '@/components/marketing/integrations/capture-surface-content';
import {
  CONNECTORS,
  getConnectorCapabilityTiers,
} from '@/components/marketing/integrations/connector-content';
import { DirectoryStructuredData } from '@/components/marketing/integrations/connector-seo';
import { RecordsToAnswer } from '@/components/marketing/integrations/records-to-answer';
import { MarketingContainer, MarketingSectionGrid } from '@/components/marketing/marketing-layout';
import { MarketingSectionIndex } from '@/components/marketing/section-index';
import { PublicShell } from '@/components/public-shell';
import { Button } from '@/components/ui/button';

const FEATURED_CAPTURE_SURFACES = CAPTURE_SURFACES.filter((surface) => surface.featured);
const SUPPORTING_CAPTURE_SURFACES = CAPTURE_SURFACES.filter((surface) => !surface.featured);

export function IntegrationDirectory({ isSignedIn }: { isSignedIn: boolean }) {
  const featuredConnector = CONNECTORS.find((connector) => connector.slug === 'slack');
  if (!featuredConnector) throw new Error('Native Slack connector content is required');
  const capabilityTiers = getConnectorCapabilityTiers();

  return (
    <PublicShell
      isSignedIn={isSignedIn}
      width="expanded"
      footerLabel="The Timeline integrations"
      currentSection="integrations"
    >
      <DirectoryStructuredData />
      <main id="main" tabIndex={-1}>
        <section className="border-b border-border">
          <MarketingContainer className="py-16 sm:py-24 lg:py-28">
            <p className="text-sm font-medium text-fg-muted">Integrations</p>
            <div className="mt-6 grid items-end gap-10 lg:grid-cols-[1.25fr_0.75fr]">
              <h1 className="max-w-[13ch] break-words text-balance text-[3rem] font-semibold leading-[0.95] tracking-[-0.05em] text-fg sm:text-[clamp(3.5rem,5vw,5.5rem)]">
                Connect the places where the work already happens.
              </h1>
              <div>
                <p className="max-w-[44ch] text-base leading-relaxed text-fg-muted sm:text-lg">
                  Deliberately route conversations, forwarded email, meeting transcripts, and
                  webhook payloads into Timeline, or select records from connected tools. Timeline
                  keeps the origin clear while it turns that work into chronology and cited answers.
                </p>
                <Button asChild size="lg" className="mt-7">
                  <Link href={isSignedIn ? '/app/sources' : '/sign-up'}>
                    {isSignedIn ? 'Open connections' : 'Create your Timeline'}
                    <ArrowRight aria-hidden="true" />
                  </Link>
                </Button>
              </div>
            </div>
          </MarketingContainer>
        </section>

        <section aria-labelledby="capture-surfaces">
          <MarketingContainer className="py-16 sm:py-20">
            <MarketingSectionGrid>
              <MarketingSectionIndex label="Send work in" />
              <div>
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <h2
                      id="capture-surfaces"
                      className="max-w-[18ch] text-3xl font-semibold tracking-tight sm:text-4xl"
                    >
                      Start where the conversation already happens.
                    </h2>
                    <p className="mt-4 max-w-[64ch] text-base leading-relaxed text-fg-muted">
                      Send messages, files, forwarded email, meeting transcripts, or webhook
                      payloads to Timeline. Each route makes it clear what is saved and who can see
                      it.
                    </p>
                  </div>
                </div>

                <div className="mt-10 grid gap-px border border-border bg-border md:grid-cols-2">
                  {FEATURED_CAPTURE_SURFACES.map((surface) => (
                    <FeaturedCaptureSurface
                      key={surface.id}
                      surface={surface}
                      isSignedIn={isSignedIn}
                    />
                  ))}
                </div>
                <div className="grid gap-px border-x border-b border-border bg-border">
                  {SUPPORTING_CAPTURE_SURFACES.map((surface) => (
                    <CaptureSurfaceRow key={surface.id} surface={surface} isSignedIn={isSignedIn} />
                  ))}
                </div>
              </div>
            </MarketingSectionGrid>
          </MarketingContainer>
        </section>

        <section className="border-t border-border" aria-labelledby="native">
          <MarketingContainer className="py-16 sm:py-20">
            <MarketingSectionGrid>
              <MarketingSectionIndex index="02" label="Connect your tools" />
              <div>
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <h2 id="native" className="text-3xl font-semibold tracking-tight sm:text-4xl">
                      Bring selected tool history into Timeline.
                    </h2>
                    <p className="mt-4 max-w-[62ch] text-base leading-relaxed text-fg-muted">
                      Choose the repositories, teams, drives, boards, channels, and projects that
                      belong in the record. Each integration page explains exactly what Timeline
                      keeps, what stays in the original tool, and which permissions it needs.
                    </p>
                  </div>
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
                          className="size-4 motion-safe:transition-transform motion-safe:group-hover:translate-x-1"
                        />
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            </MarketingSectionGrid>
          </MarketingContainer>
        </section>

        <section className="border-y border-border bg-surface">
          <MarketingContainer className="py-16 sm:py-20">
            <MarketingSectionGrid>
              <MarketingSectionIndex index="03" label="Proof" />
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
            </MarketingSectionGrid>
          </MarketingContainer>
        </section>

        <section aria-labelledby="tiers">
          <MarketingContainer className="py-16 sm:py-20">
            <MarketingSectionGrid>
              <MarketingSectionIndex index="04" label="More connections" />
              <div>
                <h2 id="tiers" className="text-3xl font-semibold tracking-tight sm:text-4xl">
                  Know what each connection can do.
                </h2>
                <p className="mt-4 max-w-[64ch] text-base leading-relaxed text-fg-muted">
                  Some connections add selected records to your Timeline. Others look up approved
                  tools only when you ask a question. Local connections require Timeline on the same
                  computer, and integrations listed as coming later cannot be connected yet.
                </p>
                <div className="mt-10 border-t border-border">
                  <CapabilityRow
                    icon={Check}
                    title="Send work to Timeline"
                    body="Telegram, Slack conversations, email forwarding, meeting transcripts, ingest webhooks"
                    live
                  />
                  <CapabilityRow
                    icon={Check}
                    title="Keep selected tool history"
                    body={capabilityTiers.nativeProviders.join(', ')}
                  />
                  <CapabilityRow
                    icon={Wrench}
                    title="Look up live tools"
                    body={capabilityTiers.mcpAccess.join(', ')}
                  />
                  <CapabilityRow
                    icon={Wrench}
                    title="Use a local desktop connection"
                    body={`${capabilityTiers.localDesktopAccess.join(', ')}. Available only when Timeline runs on the same machine; not connectable from hosted Timeline.`}
                  />
                  <CapabilityRow
                    icon={CircleDotDashed}
                    title="Coming later"
                    body={capabilityTiers.plannedProviders.join(', ')}
                  />
                </div>
              </div>
            </MarketingSectionGrid>
          </MarketingContainer>
        </section>
      </main>
    </PublicShell>
  );
}

function FeaturedCaptureSurface({
  surface,
  isSignedIn,
}: {
  surface: CaptureSurfaceContent;
  isSignedIn: boolean;
}) {
  const href = isSignedIn ? surface.setupHref : '/sign-up';

  return (
    <article className="flex min-h-96 flex-col bg-bg p-6 sm:p-8">
      <div>
        <CaptureSurfaceIcon surface={surface} />
      </div>
      <p className="mt-8 text-sm font-medium text-fg-muted">{surface.category}</p>
      <h3 className="mt-2 text-3xl font-semibold tracking-tight text-fg">{surface.name}</h3>
      <p className="mt-4 text-sm leading-relaxed text-fg-muted">{surface.summary}</p>
      <dl className="mt-6 grow space-y-4 border-t border-border pt-5 text-sm leading-relaxed">
        <div>
          <dt className="font-medium text-fg">Timeline captures</dt>
          <dd className="mt-1 text-fg-muted">{surface.captured}</dd>
        </div>
        <div>
          <dt className="font-medium text-fg">What to know</dt>
          <dd className="mt-1 text-fg-muted">{surface.boundary}</dd>
        </div>
      </dl>
      <Link
        href={href}
        className="group mt-7 inline-flex w-fit items-center gap-2 text-sm font-semibold text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {isSignedIn ? surface.setupLabel : `Start with ${surface.name}`}
        <ArrowRight
          aria-hidden="true"
          className="size-4 motion-safe:transition-transform motion-safe:group-hover:translate-x-1"
        />
      </Link>
    </article>
  );
}

function CaptureSurfaceRow({
  surface,
  isSignedIn,
}: {
  surface: CaptureSurfaceContent;
  isSignedIn: boolean;
}) {
  const href = isSignedIn ? surface.setupHref : '/sign-up';

  return (
    <article className="grid gap-6 bg-bg p-6 sm:p-8 lg:grid-cols-[1.1fr_1fr_1fr] lg:gap-10">
      <div>
        <div>
          <CaptureSurfaceIcon surface={surface} />
        </div>
        <p className="mt-5 text-sm font-medium text-fg-muted">{surface.category}</p>
        <h3 className="mt-2 text-2xl font-semibold tracking-tight text-fg">{surface.name}</h3>
        <p className="mt-3 text-sm leading-relaxed text-fg-muted">{surface.summary}</p>
        <Link
          href={href}
          className="group mt-5 inline-flex w-fit items-center gap-2 text-sm font-semibold text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {isSignedIn ? surface.setupLabel : `Start with ${surface.name}`}
          <ArrowRight
            aria-hidden="true"
            className="size-4 motion-safe:transition-transform motion-safe:group-hover:translate-x-1"
          />
        </Link>
      </div>
      <div className="border-t border-border pt-5 lg:border-t-0 lg:pt-0">
        <p className="font-medium text-fg">Timeline captures</p>
        <p className="mt-2 text-sm leading-relaxed text-fg-muted">{surface.captured}</p>
      </div>
      <div className="border-t border-border pt-5 lg:border-t-0 lg:pt-0">
        <p className="font-medium text-fg">What to know</p>
        <p className="mt-2 text-sm leading-relaxed text-fg-muted">{surface.boundary}</p>
      </div>
    </article>
  );
}

function CaptureSurfaceIcon({ surface }: { surface: CaptureSurfaceContent }) {
  if (surface.icon === 'telegram' || surface.icon === 'slack') {
    return (
      <div className="grid size-12 place-items-center rounded-md border border-border bg-surface dark:bg-white">
        <Image
          src={`/connectors/${surface.icon === 'telegram' ? 'telegram' : 'slack'}.svg`}
          alt=""
          width={30}
          height={30}
          className="size-7"
        />
      </div>
    );
  }

  const Icon = surface.icon === 'mail' ? Mail : surface.icon === 'video' ? Video : Webhook;
  return (
    <div className="grid size-12 place-items-center rounded-md border border-border bg-surface">
      <Icon aria-hidden="true" className="size-6 text-fg" strokeWidth={1.5} />
    </div>
  );
}

function CapabilityRow({
  icon: Icon,
  title,
  body,
  live = false,
}: {
  icon: typeof Check;
  title: string;
  body: string;
  live?: boolean;
}) {
  return (
    <article className="grid gap-4 border-b border-border py-6 sm:grid-cols-[2rem_13rem_1fr] sm:items-center">
      <Icon aria-hidden="true" className={live ? 'size-4 text-signal' : 'size-4 text-fg-dim'} />
      <h3 className="font-semibold text-fg">{title}</h3>
      <p className="text-sm leading-relaxed text-fg-muted">{body}</p>
    </article>
  );
}
