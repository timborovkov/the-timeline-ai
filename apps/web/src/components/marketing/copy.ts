import { TELEGRAM_PAGE } from '@/components/marketing/integrations/telegram-content';
import { WORKS_WITH_TOOLS } from '@/components/marketing/integrations/works-with-content';

export const START_FREE_LABEL = 'Start free';
export const START_FREE_HREF = '/sign-up' as const;
export const SEE_IT_FIRST_LABEL = 'See it first';
export const SEE_IT_FIRST_HREF = '/product-tour' as const;
export const CTA_MICROCOPY_LEAD = 'Free for up to 3 members · no card required ·';
export const FICTIONAL_EXAMPLE_LABEL = 'Fictional example · Acme Labs demo workspace';
export const PRODUCT_SCREENSHOT_DIR = '/marketing/screenshots';

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
] as const;

const FEATURED_INTEGRATION_NAV_ITEMS = [
  { href: '/integrations/slack' as const, label: 'Slack', statusLabel: 'Native sync' },
  { href: TELEGRAM_PAGE.route, label: 'Telegram', statusLabel: 'Capture' },
  {
    href: '/integrations/google-drive' as const,
    label: 'Google Drive',
    statusLabel: 'Native sync',
  },
  { href: '/integrations/github' as const, label: 'GitHub', statusLabel: 'Native sync' },
] as const;

const MONDAY_NAV_ITEM = {
  href: '/integrations/monday' as const,
  label: 'Monday.com',
  statusLabel: 'Native sync',
} as const;

export const INTEGRATION_NAV_ITEMS = [
  ...FEATURED_INTEGRATION_NAV_ITEMS,
  ...WORKS_WITH_TOOLS.flatMap((tool) => {
    if (tool.status === 'coming-soon') return [];
    const item = {
      href: tool.route,
      label: tool.name,
      statusLabel: tool.statusLabel,
    };
    return tool.slug === 'linear' ? [item, MONDAY_NAV_ITEM] : [item];
  }),
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
