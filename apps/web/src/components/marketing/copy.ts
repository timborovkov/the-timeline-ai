import { TELEGRAM_PAGE } from '@/components/marketing/integrations/telegram-content';

export const START_FREE_LABEL = 'Start free';
export const START_FREE_HREF = '/sign-up' as const;
export const SEE_IT_FIRST_LABEL = 'See it first';
export const SEE_IT_FIRST_HREF = '/product-tour' as const;
export const CTA_MICROCOPY_LEAD = 'Free for up to 3 members · no card required ·';
export const FICTIONAL_EXAMPLE_LABEL = 'Fictional example · Acme Labs demo workspace';
export const PRODUCT_SCREENSHOT_DIR = '/marketing/screenshots';

export const FIRST_RUN_STEPS = [
  {
    index: '01',
    title: 'Your first team is created',
    detail: 'We create it automatically when you sign up. No card is required.',
  },
  {
    index: '02',
    title: 'Connect one capture source',
    detail:
      'A Slack channel, a Telegram group, or forwarded email is enough. You do not need every connector.',
  },
  {
    index: '03',
    title: 'Open the first record, or ask',
    detail: 'Once something has landed, the source stays attached. Ask from Home or Ask.',
  },
] as const;

export const FIRST_RUN_NOTE =
  'A linked Slack channel or Telegram group captures the conversation. Plain-text questions in a direct chat ask the agent; explicit notes and supported media can still be captured.';

export const USE_CASE_NAV_ITEMS = [
  { href: '/use-cases/work-record', label: 'Work record' },
  { href: '/use-cases/team-daily-log', label: 'Team daily log' },
  { href: '/use-cases/communication-trail', label: 'Communication trail' },
  { href: '/use-cases/crm', label: 'CRM' },
  { href: '/use-cases/task-board', label: 'Task board' },
  {
    href: '/use-cases/onboarding-and-repeat-questions',
    label: 'Onboarding and repeat questions',
  },
  { href: '/product-tour', label: 'Product tour' },
] as const;

export const COMPARE_NAV_ITEMS = [
  { href: '/compare/the-timeline-vs-day-ai', label: 'The Timeline vs Day AI' },
  { href: '/compare/the-timeline-vs-folk', label: 'The Timeline vs Folk' },
  { href: '/compare/the-timeline-vs-glean', label: 'The Timeline vs Glean' },
  { href: '/compare/the-timeline-vs-geekbot', label: 'The Timeline vs Geekbot' },
  { href: '/compare/the-timeline-vs-suda', label: 'The Timeline vs Suda' },
  { href: '/compare/the-timeline-vs-memorycrow', label: 'The Timeline vs MemoryCrow' },
  { href: '/compare/the-timeline-vs-achiral', label: 'The Timeline vs Achiral' },
] as const;

const NATIVE_AND_CAPTURE_NAV_ITEMS = [
  {
    href: '/integrations/slack' as const,
    label: 'Slack',
    statusLabel: 'Native sync' as const,
  },
  {
    href: TELEGRAM_PAGE.route,
    label: 'Telegram',
    statusLabel: 'Capture' as const,
  },
  { href: '/integrations/google-drive' as const, label: 'Google Drive' },
  { href: '/integrations/github' as const, label: 'GitHub' },
  { href: '/integrations/linear' as const, label: 'Linear' },
  { href: '/integrations/monday' as const, label: 'Monday.com' },
  { href: '/integrations/sentry' as const, label: 'Sentry' },
] as const;

export const INTEGRATION_NAV_ITEMS = [
  ...NATIVE_AND_CAPTURE_NAV_ITEMS,
  {
    href: '/integrations/mcp' as const,
    label: 'Connect MCP tools',
    group: 'agent-tools' as const,
  },
];

export function publicNavItemLabel(item: { label: string; statusLabel?: string }): string {
  return item.statusLabel ? `${item.label} · ${item.statusLabel}` : item.label;
}

export const TIMELINE_AGENT_SETUP_COMMAND = 'Set up The Timeline - https://thetimeline.cc/llms.txt';

export const AGENT_SETUP_CARD = {
  kicker: 'For agents',
  title: 'Give your agents the work record — and let them write back like teammates.',
  body: 'They read what the team said in Slack, email, calls and docs, then add their own notes to the same cited log.',
} as const;
