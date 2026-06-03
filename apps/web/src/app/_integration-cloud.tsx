import * as integrationsLib from '@timeline/shared/integrations/registry';
import Image from 'next/image';
import Link from 'next/link';

import { cn } from '@/lib/utils';

// Landing-page integration cloud:
// shape: featured logos in a grid + an example-prompt strip + an
// extensibility tagline that points at /app/team/mcp-servers as the
// long-tail escape hatch. Server component (catalog is static at build
// time apart from env checks for native availability, which are also
// resolved server-side).

export function IntegrationCloud() {
  const featured = integrationsLib.listFeaturedCatalog();
  const prompts: string[] = [];
  const seenPrompts = new Set<string>();
  for (const connector of featured) {
    if (!seenPrompts.has(connector.examplePrompt)) {
      seenPrompts.add(connector.examplePrompt);
      prompts.push(connector.examplePrompt);
      if (prompts.length === 4) break;
    }
  }

  return (
    <div className="space-y-12">
      {/* Logo cloud */}
      <ul className="grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
        {featured.map((c) => (
          <li
            key={c.id}
            className="flex flex-col items-center gap-2 rounded-sm border border-border bg-surface p-4 text-center"
          >
            <span className="grid size-12 place-items-center rounded-sm bg-surface-2 p-2">
              {/* The catalog ships SVG logos under apps/web/public/connectors/.
                  Plain <img> is fine — connector marks are small, eagerly
                  visible inside the cloud, and need no Next/Image
                  optimization pipeline. */}
              <Image src={c.logo} alt="" width={28} height={28} className="size-7" />
            </span>
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg">
              {c.label}
            </span>
            <StatusPill status={c.status} />
          </li>
        ))}
        <li className="flex flex-col items-center justify-center gap-2 rounded-sm border border-dashed border-border bg-surface p-4 text-center">
          <span className="grid size-12 place-items-center rounded-sm bg-surface-2 font-mono text-lg text-fg-muted">
            +
          </span>
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg-muted">
            Any MCP server
          </span>
          <span className="text-[10px] uppercase tracking-[0.14em] text-fg-dim">long tail</span>
        </li>
      </ul>

      {/* Example prompts */}
      <div className="mx-auto max-w-2xl">
        <div className="mb-3 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-fg-muted">
          Questions the agent answers once connected
        </div>
        <ul className="space-y-2">
          {prompts.map((p) => (
            <li
              key={p}
              className="rounded-sm border border-border bg-surface px-4 py-2 text-center text-sm text-fg-muted"
            >
              <span className="italic">&ldquo;{p}&rdquo;</span>
            </li>
          ))}
        </ul>
      </div>

      <p className="text-center text-xs text-fg-dim">
        Works with any MCP-compatible server. Custom servers connect under{' '}
        <Link
          href="/app/team/mcp-servers"
          className="underline-offset-4 hover:text-fg hover:underline"
        >
          team settings
        </Link>
        , bring your own auth.
      </p>
    </div>
  );
}

function StatusPill({ status }: { status: integrationsLib.IntegrationStatus }) {
  const label =
    status === 'native_available'
      ? 'Native'
      : status === 'native_unconfigured'
        ? 'Native'
        : status === 'mcp_available'
          ? 'MCP'
          : 'Soon';
  const tone =
    status === 'native_available' || status === 'mcp_available'
      ? 'border-signal/40 bg-signal/10 text-signal'
      : 'border-border bg-surface-2 text-fg-dim';
  return (
    <span
      className={cn(
        'rounded-sm border px-1.5 py-[1px] font-mono text-[9px] uppercase tracking-[0.14em]',
        tone,
      )}
    >
      {label}
    </span>
  );
}
