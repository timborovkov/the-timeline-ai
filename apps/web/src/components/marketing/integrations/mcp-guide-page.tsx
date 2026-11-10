import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

import { EditorialKicker } from '@/components/marketing/editorial/editorial-kicker';
import { EditorialStructuredData } from '@/components/marketing/editorial/editorial-structured-data';
import styles from '@/components/marketing/editorial/editorial.module.css';
import { InboundMcpDiagram } from '@/components/marketing/integrations/inbound-mcp-diagram';
import {
  MCP_GUIDE_PAGE,
  MCP_GUIDE_RELATED,
  getMcpGuideCatalog,
} from '@/components/marketing/integrations/mcp-guide-content';
import { MCP_GUIDE_DOCUMENT } from '@/components/marketing/integrations/mcp-guide-public-documents';
import { MarketingContainer, MarketingSectionGrid } from '@/components/marketing/marketing-layout';
import { MarketingProductScreenshot } from '@/components/marketing/product-screenshot';
import { MarketingSectionIndex } from '@/components/marketing/section-index';
import { MarketingCtaBand, StartFreeLink } from '@/components/marketing/start-free-cta';
import { PublicSessionBranch } from '@/components/public-session-branch';
import { PublicShell } from '@/components/public-shell';
import { buildPublicStructuredData } from '@/lib/public-site';
import { getSiteUrl } from '@/lib/site-url';

export function McpGuidePage() {
  const catalog = getMcpGuideCatalog();

  return (
    <PublicShell footerLabel="Connect MCP tools" currentSection="integrations">
      <EditorialStructuredData data={buildPublicStructuredData(MCP_GUIDE_DOCUMENT, getSiteUrl())} />
      <main id="main" tabIndex={-1} data-mcp-guide>
        <section className="border-b border-border">
          <MarketingContainer className="py-16 sm:py-24 lg:py-28">
            <Link
              href="/integrations"
              className="mb-10 inline-flex min-h-10 items-center rounded-sm text-sm font-medium text-fg-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            >
              All integrations
            </Link>
            <EditorialKicker>{MCP_GUIDE_PAGE.kicker}</EditorialKicker>
            <div className="mt-8 grid items-end gap-10 lg:grid-cols-[1.25fr_0.75fr]">
              <h1 className={`${styles.displayTitle} max-w-[16ch]`}>{MCP_GUIDE_PAGE.title}</h1>
              <div>
                <p className="max-w-[44ch] text-base leading-relaxed text-fg-muted sm:text-lg">
                  {MCP_GUIDE_PAGE.summary}
                </p>
                <div className="mt-7 flex flex-wrap gap-3">
                  <StartFreeLink className="inline-flex min-h-12 items-center gap-2 rounded-sm bg-signal px-5 font-semibold text-signal-fg outline-none hover:brightness-95 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" />
                  <PublicSessionBranch
                    signedOut={null}
                    signedIn={
                      <Link
                        href={MCP_GUIDE_PAGE.setup.teamHref}
                        className="inline-flex min-h-12 items-center gap-2 rounded-sm border border-border px-5 font-semibold outline-none hover:bg-surface focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {MCP_GUIDE_PAGE.setup.teamLabel}
                        <ArrowRight aria-hidden="true" className="size-4" />
                      </Link>
                    }
                  />
                </div>
              </div>
            </div>
          </MarketingContainer>
        </section>

        <section className="border-b border-border" aria-labelledby="mcp-directions">
          <MarketingContainer className="py-16 sm:py-20">
            <MarketingSectionGrid>
              <MarketingSectionIndex index="01" label="Directions" />
              <div>
                <h2
                  id="mcp-directions"
                  className="max-w-[20ch] text-3xl font-semibold tracking-tight sm:text-4xl"
                >
                  {MCP_GUIDE_PAGE.distinction.title}
                </h2>
                <div className="mt-10 grid gap-px border border-border bg-border sm:grid-cols-2">
                  <article className="bg-bg p-6 sm:p-8">
                    <h3 className="text-xl font-semibold tracking-tight text-fg">
                      {MCP_GUIDE_PAGE.distinction.inboundTitle}
                    </h3>
                    <p className="mt-4 text-sm leading-relaxed text-fg-muted">
                      {MCP_GUIDE_PAGE.distinction.inboundBody}
                    </p>
                  </article>
                  <article className="bg-bg p-6 sm:p-8">
                    <h3 className="text-xl font-semibold tracking-tight text-fg">
                      {MCP_GUIDE_PAGE.distinction.outboundTitle}
                    </h3>
                    <p className="mt-4 text-sm leading-relaxed text-fg-muted">
                      {MCP_GUIDE_PAGE.distinction.outboundBody}
                    </p>
                    <Link
                      href="/agents"
                      className="group mt-6 inline-flex w-fit items-center gap-2 text-sm font-semibold text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Go to Agents
                      <ArrowRight
                        aria-hidden="true"
                        className="size-4 motion-safe:transition-transform motion-safe:group-hover:translate-x-1"
                      />
                    </Link>
                  </article>
                </div>
                <div className="mt-10">
                  <InboundMcpDiagram />
                </div>
              </div>
            </MarketingSectionGrid>
          </MarketingContainer>
        </section>

        <section className="border-b border-border bg-surface/45" aria-labelledby="mcp-setup">
          <MarketingContainer className="py-16 sm:py-20">
            <MarketingSectionGrid>
              <MarketingSectionIndex index="02" label="In the product" />
              <div>
                <h2
                  id="mcp-setup"
                  className="max-w-[20ch] text-3xl font-semibold tracking-tight sm:text-4xl"
                >
                  {MCP_GUIDE_PAGE.setup.title}
                </h2>
                <p className="mt-4 max-w-[64ch] text-base leading-relaxed text-fg-muted">
                  {MCP_GUIDE_PAGE.setup.intro}
                </p>
                <p
                  className="mt-4 max-w-[64ch] text-sm leading-relaxed text-fg-muted"
                  data-mcp-plan-limit
                >
                  {MCP_GUIDE_PAGE.setup.planLimit}
                </p>
                <div className="mt-10">
                  <MarketingProductScreenshot
                    file={MCP_GUIDE_PAGE.screenshot.file}
                    alt={MCP_GUIDE_PAGE.screenshot.alt}
                    caption={MCP_GUIDE_PAGE.screenshot.caption}
                  />
                </div>
                <div className="mt-10 grid gap-8">
                  <SetupPath
                    title={MCP_GUIDE_PAGE.setup.teamTitle}
                    body={MCP_GUIDE_PAGE.setup.teamBody}
                    href={MCP_GUIDE_PAGE.setup.teamHref}
                    label={MCP_GUIDE_PAGE.setup.teamLabel}
                  />
                  <SetupPath
                    title={MCP_GUIDE_PAGE.setup.personalTitle}
                    body={MCP_GUIDE_PAGE.setup.personalBody}
                    href={MCP_GUIDE_PAGE.setup.personalHref}
                    label={MCP_GUIDE_PAGE.setup.personalLabel}
                  />
                  <div>
                    <h3 className="text-xl font-semibold tracking-tight text-fg">
                      {MCP_GUIDE_PAGE.setup.formTitle}
                    </h3>
                    <p className="mt-3 max-w-[64ch] text-sm leading-relaxed text-fg-muted">
                      {MCP_GUIDE_PAGE.setup.formBody}
                    </p>
                  </div>
                </div>
              </div>
            </MarketingSectionGrid>
          </MarketingContainer>
        </section>

        <section className="border-b border-border" aria-labelledby="mcp-catalog">
          <MarketingContainer className="py-16 sm:py-20">
            <MarketingSectionGrid>
              <MarketingSectionIndex index="03" label="Catalog" />
              <div>
                <h2
                  id="mcp-catalog"
                  className="max-w-[20ch] text-3xl font-semibold tracking-tight sm:text-4xl"
                >
                  {MCP_GUIDE_PAGE.catalog.title}
                </h2>
                <p className="mt-4 max-w-[64ch] text-base leading-relaxed text-fg-muted">
                  {MCP_GUIDE_PAGE.catalog.intro} Hosted catalog tools today:{' '}
                  {catalog.hostedToolsLabel}.
                </p>
                {catalog.localDesktopTools.length > 0 ? (
                  <p className="mt-4 max-w-[64ch] text-base leading-relaxed text-fg-muted">
                    {MCP_GUIDE_PAGE.catalog.localTitle}: {catalog.localDesktopToolsLabel}.{' '}
                    {MCP_GUIDE_PAGE.catalog.localBody}
                  </p>
                ) : null}
                <p className="mt-4 max-w-[64ch] text-base leading-relaxed text-fg-muted">
                  {MCP_GUIDE_PAGE.notNative.body}
                </p>
              </div>
            </MarketingSectionGrid>
          </MarketingContainer>
        </section>

        <section className="border-b border-border" aria-labelledby="mcp-limits">
          <MarketingContainer className="py-16 sm:py-20">
            <MarketingSectionGrid>
              <MarketingSectionIndex index="04" label="Limits" />
              <div>
                <h2
                  id="mcp-limits"
                  className="max-w-[20ch] text-3xl font-semibold tracking-tight sm:text-4xl"
                >
                  {MCP_GUIDE_PAGE.limits.title}
                </h2>
                <ul className="mt-6 list-disc space-y-3 pl-5 text-base leading-7 text-fg-muted">
                  {MCP_GUIDE_PAGE.limits.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <div className="mt-10 grid gap-px border border-border bg-border sm:grid-cols-2">
                  {MCP_GUIDE_RELATED.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="group bg-bg p-6 outline-none hover:bg-surface focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:p-8"
                    >
                      <h3 className="text-xl font-semibold tracking-tight text-fg">{item.label}</h3>
                      <span className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-fg">
                        Open
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

        <MarketingCtaBand
          title="Start with the conversation record."
          body="Link Slack or Telegram first if you need a work record. Add MCP tools later when The Timeline Agent should look something up live."
        />
      </main>
    </PublicShell>
  );
}

function SetupPath({
  title,
  body,
  href,
  label,
}: {
  title: string;
  body: string;
  href: string;
  label: string;
}) {
  return (
    <div>
      <h3 className="text-xl font-semibold tracking-tight text-fg">{title}</h3>
      <p className="mt-3 max-w-[64ch] text-sm leading-relaxed text-fg-muted">{body}</p>
      <PublicSessionBranch
        signedOut={
          <Link
            href="/sign-in"
            className="group mt-4 inline-flex w-fit items-center gap-2 text-sm font-semibold text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Sign in to {label}
            <ArrowRight
              aria-hidden="true"
              className="size-4 motion-safe:transition-transform motion-safe:group-hover:translate-x-1"
            />
          </Link>
        }
        signedIn={
          <Link
            href={href}
            className="group mt-4 inline-flex w-fit items-center gap-2 text-sm font-semibold text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {label}
            <ArrowRight
              aria-hidden="true"
              className="size-4 motion-safe:transition-transform motion-safe:group-hover:translate-x-1"
            />
          </Link>
        }
      />
    </div>
  );
}
