import { CONNECTORS } from '@/components/marketing/integrations/connector-content';

export const INTEGRATION_CAPABILITY_ANSWERS = [
  {
    title: 'Native sync',
    body: `Sync supported records from selected and activated sources into a cited work history. Native sync is available for ${CONNECTORS.map(({ name }) => name).join(', ')}.`,
  },
  {
    title: 'Deliberate capture',
    body: 'Send selected work through Slack conversation capture, Telegram, forwarded email, recorded meetings, webhooks, or website scans. The work record contains the evidence you route or select.',
  },
  {
    title: 'Live lookup',
    body: 'Enabled hosted MCP tools can look up provider information when you ask, without importing tool history. Figma desktop MCP requires Timeline on the same machine.',
    links: [{ label: 'Connect MCP tools', href: '/integrations/mcp' }],
  },
  {
    title: 'Historical coverage',
    body: 'Backfill and reconciliation vary by connector and record type. For example, GitHub caps the initial default-branch scan at 2,000 commits, and Linear field-change history starts when Timeline begins observing a selected team.',
  },
  {
    title: 'Permissions',
    body: 'For native sync, a connection owner shares selected sources and a team admin activates them. Captured records follow Timeline visibility rules. Live lookups use the permissions of the enabled tool connection.',
  },
] as const;
