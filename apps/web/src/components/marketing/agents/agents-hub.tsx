import Link from 'next/link';

import { AgentSetupCard } from '@/components/marketing/agents/agent-setup-card';
import { AGENTS_HUB_DOCUMENT } from '@/components/marketing/agents/public-documents';
import { EditorialKicker } from '@/components/marketing/editorial/editorial-kicker';
import { EditorialStructuredData } from '@/components/marketing/editorial/editorial-structured-data';
import styles from '@/components/marketing/editorial/editorial.module.css';
import { MarketingContainer, MarketingSectionGrid } from '@/components/marketing/marketing-layout';
import { MarketingSectionIndex } from '@/components/marketing/section-index';
import { MarketingCtaBand } from '@/components/marketing/start-free-cta';
import { TIMELINE_HOSTED_MCP_TOOLS_LIST, TIMELINE_MCP_COMMAND } from '@/lib/agent-install-content';
import { buildPublicStructuredData } from '@/lib/public-site';
import { getSiteUrl } from '@/lib/site-url';

export function AgentsHubPage() {
  return (
    <main id="main" tabIndex={-1} data-agents-hub>
      <EditorialStructuredData
        data={buildPublicStructuredData(AGENTS_HUB_DOCUMENT, getSiteUrl())}
      />
      <header className="border-b border-border">
        <MarketingContainer className="py-16 sm:py-24 lg:py-28">
          <EditorialKicker>Agents</EditorialKicker>
          <h1 className={`${styles.displayTitle} mt-6`}>Give this to your agent.</h1>
          <p className="mt-7 max-w-2xl text-lg leading-8 text-fg-muted sm:text-xl">
            One line sets up The Timeline for Claude, ChatGPT, Cursor, Grok, OpenClaw or Hermes. The
            public file covers the MCP server, OAuth, ingest email, webhooks and the timeline skill.
          </p>
          <div className="mt-10 max-w-3xl">
            <AgentSetupCard />
          </div>
        </MarketingContainer>
      </header>

      <section className="border-b border-border">
        <MarketingContainer className="py-16 sm:py-20">
          <MarketingSectionGrid>
            <MarketingSectionIndex index="01" label="Connect" />
            <div className="max-w-3xl">
              <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                Hosted MCP, then your sources.
              </h2>
              <p className="mt-4 text-base leading-7 text-fg-muted">
                Compatible clients open{' '}
                <code className="font-mono text-sm text-fg">
                  https://thetimeline.cc/api/mcp/server
                </code>
                . Sign in, choose a team, and approve scopes in the browser. Static team keys (
                <code className="font-mono text-sm">tla_</code>) are a manual fallback and see
                team-visible data only.
              </p>
              <pre className="mt-6 overflow-x-auto rounded-md border border-border bg-surface p-4 font-mono text-xs leading-6">
                {TIMELINE_MCP_COMMAND}
              </pre>
              <ul className="mt-6 list-disc space-y-3 pl-5 text-base leading-7 text-fg-muted">
                <li>
                  The hosted server advertises five tools:{' '}
                  <code className="font-mono text-sm text-fg">
                    {TIMELINE_HOSTED_MCP_TOOLS_LIST}
                  </code>
                  .
                </li>
                <li>
                  OAuth consent has a separate capture checkbox, on by default, so{' '}
                  <code className="font-mono text-sm text-fg">timeline.remember</code> can store a
                  cited note. Uncheck it for a read-only grant.{' '}
                  <code className="font-mono text-sm text-fg">timeline.ask</code> needs a separate
                  owner or admin <code className="font-mono text-sm text-fg">agent:ask</code> scope.
                </li>
                <li>
                  Remember notes use the same ingest path as other accepted sources, so they count
                  toward the Free plan accepted-sources meter. They never change canonical records.
                </li>
                <li>
                  The Timeline skill lives in{' '}
                  <code className="font-mono text-sm text-fg">plugins/timeline</code> and is bundled
                  for Codex and Claude Code.
                </li>
                <li>
                  Forward, CC or BCC mail to the team inbound address to capture email.
                  Authenticated{' '}
                  <code className="font-mono text-sm text-fg">POST /api/webhooks/ingest</code>{' '}
                  accepts a <code className="font-mono text-sm">tli_</code> bearer key or a one-time
                  URL.
                </li>
              </ul>
              <p className="mt-6">
                <Link
                  href="/help/agents"
                  className="rounded-sm font-medium text-fg underline decoration-border-strong underline-offset-4 outline-none hover:decoration-fg focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Full agent install guide
                </Link>
              </p>
            </div>
          </MarketingSectionGrid>
        </MarketingContainer>
      </section>

      <MarketingCtaBand
        title="Start free, then connect an agent."
        body="Create a workspace, capture one channel or a few emails, and let the agent read the same cited record."
      />
    </main>
  );
}
