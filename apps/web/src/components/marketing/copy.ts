import { TELEGRAM_PAGE } from '@/components/marketing/integrations/telegram-content';

export const START_FREE_LABEL = 'Start free';
export const START_FREE_HREF = '/sign-up' as const;
export const SEE_IT_FIRST_LABEL = 'Take the tour';
export const SEE_IT_FIRST_HREF = '/product-tour' as const;
export const CTA_MICROCOPY_LEAD = 'Free for up to 3 members · no card required ·';
export const PRODUCT_SCREENSHOT_DIR = '/marketing/screenshots';

export const FIRST_RUN_STEPS = [
  {
    index: '01',
    title: 'Your first team is created',
    detail: 'We create it automatically when you sign up. No card is required.',
  },
  {
    index: '02',
    title: 'Bring something in',
    detail:
      'Start with a document, website or forwarded email. You can also connect a relevant Slack channel or Telegram group from Sources.',
  },
  {
    index: '03',
    title: 'Ask about the work',
    detail:
      'Once activity is available, ask a question from Home or Ask and follow the answer back to its sources.',
  },
] as const;

export const FIRST_RUN_NOTE =
  'A linked Slack channel or Telegram group captures the conversation. Plain-text questions in a direct chat ask the agent; explicit notes and supported media can still be captured.';

export const USE_CASE_NAV_ITEMS = [
  { href: '/use-cases/team-daily-log', label: 'Team daily log' },
  { href: '/use-cases/communication-trail', label: 'Communication trail' },
  { href: '/use-cases/customer-context', label: 'Customer context' },
  { href: '/use-cases/task-board', label: 'Task board' },
  {
    href: '/use-cases/onboarding-and-repeat-questions',
    label: 'Picking up work',
  },
  { href: '/solutions/client-project-handoffs', label: 'Work handoffs' },
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
  title: 'Give your agents the context to pick up work.',
  body: 'Agents can read permitted workspace context and record their progress as attributed notes.',
} as const;
