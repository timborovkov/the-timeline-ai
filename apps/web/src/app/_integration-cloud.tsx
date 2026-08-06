import * as integrationsLib from '@timeline/shared/integrations/registry';
import Image from 'next/image';
import Link from 'next/link';

// Landing-page integration cloud:
// shape: featured logos in a grid + an example-prompt strip + an
// extensibility tagline that points at /app/team/mcp-servers as the
// long-tail escape hatch. Server component (catalog is static at build
// time apart from env checks for native availability, which are also
// resolved server-side).

interface CuratedLogo {
  id: string;
  label: string;
  logo: string;
}

const CURATED_LOGOS: CuratedLogo[] = [
  { id: 'slack', label: 'Slack', logo: '/connectors/slack.svg' },
  { id: 'telegram', label: 'Telegram', logo: '/connectors/telegram.svg' },
  { id: 'email-cc', label: 'Email CC', logo: '/connectors/gmail.svg' },
  { id: 'google-meet', label: 'Google Meet', logo: '/connectors/google-meet.svg' },
  { id: 'microsoft-teams', label: 'Teams', logo: '/connectors/microsoft-teams.svg' },
  { id: 'zoom', label: 'Zoom', logo: '/connectors/zoom.svg' },
  { id: 'google-drive', label: 'Drive', logo: '/connectors/google-drive.svg' },
  { id: 'notion', label: 'Notion', logo: '/connectors/notion.svg' },
  { id: 'linear', label: 'Linear', logo: '/connectors/linear.svg' },
  { id: 'github', label: 'GitHub', logo: '/connectors/github.svg' },
  { id: 'jira', label: 'Jira', logo: '/connectors/jira.svg' },
  { id: 'salesforce', label: 'Salesforce', logo: '/connectors/salesforce.svg' },
  { id: 'pipedrive', label: 'Pipedrive', logo: '/connectors/pipedrive.svg' },
  { id: 'hubspot', label: 'HubSpot', logo: '/connectors/hubspot.svg' },
  { id: 'figma', label: 'Figma', logo: '/connectors/figma.svg' },
] as const;

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
    <div className="mt-12 space-y-10">
      {/* Logo cloud */}
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
        {CURATED_LOGOS.map((c) => (
          <li
            key={c.id}
            className="flex min-h-28 flex-col items-center justify-center gap-3 border border-border bg-surface px-3 py-4 text-center"
          >
            <span className="grid size-12 place-items-center rounded-sm bg-surface-2 p-2">
              <Image
                src={c.logo}
                alt=""
                width={48}
                height={48}
                className="h-auto w-auto max-h-7 max-w-16 object-contain"
                unoptimized
              />
            </span>
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg">
              {c.label}
            </span>
          </li>
        ))}
      </ul>

      {/* Example prompts */}
      <div className="mx-auto max-w-2xl">
        <div className="mb-3 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-fg-muted">
          Questions from captured evidence and connected context
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
        Need an internal tool? Connect any MCP-compatible server under{' '}
        <Link
          href="/app/team/mcp-servers"
          className="rounded-sm underline-offset-4 hover:text-fg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          team settings
        </Link>
        .
      </p>
    </div>
  );
}
