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
  wide?: boolean;
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
  { id: 'salesforce', label: 'Salesforce', logo: '/connectors/salesforce.svg', wide: true },
  { id: 'pipedrive', label: 'Pipedrive', logo: '/connectors/pipedrive.svg', wide: true },
  { id: 'hubspot', label: 'HubSpot', logo: '/connectors/hubspot.svg' },
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
    <div className="space-y-12">
      {/* Logo cloud */}
      <ul className="grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
        {CURATED_LOGOS.map((c) => {
          const logoSize = c.wide
            ? 'grid h-12 w-28 place-items-center rounded-sm bg-surface-2 p-2'
            : 'grid size-12 place-items-center rounded-sm bg-surface-2 p-2';
          const imageSize = c.wide ? 'h-8 w-24 object-contain' : 'size-7';
          const imageWidth = c.wide ? 96 : 28;
          const imageHeight = c.wide ? 32 : 28;

          return (
            <li
              key={c.id}
              className="flex flex-col items-center gap-2 rounded-sm border border-border bg-surface p-4 text-center"
            >
              <span className={logoSize}>
                <Image
                  src={c.logo}
                  alt=""
                  width={imageWidth}
                  height={imageHeight}
                  className={imageSize}
                  unoptimized
                />
              </span>
              <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg">
                {c.label}
              </span>
            </li>
          );
        })}
        <li className="flex flex-col items-center justify-center gap-2 rounded-sm border border-dashed border-border bg-surface p-4 text-center">
          <span className="grid size-12 place-items-center rounded-sm bg-surface-2 font-mono text-lg text-fg-muted">
            +
          </span>
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg-muted">
            Any MCP server
          </span>
          <span className="text-[10px] uppercase tracking-[0.14em] text-fg-dim">
            internal tools
          </span>
        </li>
      </ul>

      {/* Example prompts */}
      <div className="mx-auto max-w-2xl">
        <div className="mb-3 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-fg-muted">
          Questions the agent can answer once connected
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
        Work with any MCP-compatible server. Custom servers connect under{' '}
        <Link
          href="/app/team/mcp-servers"
          className="underline-offset-4 hover:text-fg hover:underline"
        >
          team settings
        </Link>
        , bring your own auth, and let Timeline reach the tools that matter to your team.
      </p>
    </div>
  );
}
