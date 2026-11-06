import type { PublicSurface } from '@timeline/shared/analytics';

export const PUBLIC_ANALYTICS_ROUTES = Object.freeze({
  '/': 'home',
  '/pricing': 'pricing',
  '/how-it-works': 'how_it_works',
  '/integrations': 'integrations',
  '/integrations/slack': 'integration_slack',
  '/integrations/github': 'integration_github',
  '/integrations/linear': 'integration_linear',
  '/integrations/google-drive': 'integration_google_drive',
  '/integrations/monday': 'integration_monday',
  '/integrations/sentry': 'integration_sentry',
  '/integrations/telegram': 'integration_telegram',
  '/integrations/hubspot': 'integration_hubspot',
  '/integrations/pipedrive': 'integration_pipedrive',
  '/integrations/attio': 'integration_attio',
  '/integrations/jira': 'integration_jira',
  '/integrations/notion': 'integration_notion',
  '/product-tour': 'product_tour',
  '/use-cases': 'use_cases',
  '/compare': 'compare',
  '/compare/the-timeline-vs-day-ai': 'compare_day_ai',
  '/compare/the-timeline-vs-folk': 'compare_folk',
  '/compare/the-timeline-vs-glean': 'compare_glean',
  '/compare/the-timeline-vs-geekbot': 'compare_geekbot',
  '/compare/the-timeline-vs-suda': 'compare_suda',
  '/compare/the-timeline-vs-memorycrow': 'compare_memorycrow',
  '/compare/the-timeline-vs-achiral': 'compare_achiral',
  '/agents': 'agents',
  '/use-cases/work-record': 'use_case_work_record',
  '/use-cases/team-daily-log': 'use_case_team_daily_log',
  '/use-cases/communication-trail': 'use_case_communication_trail',
  '/use-cases/crm': 'use_case_crm',
  '/use-cases/task-board': 'use_case_task_board',
  '/use-cases/onboarding-and-repeat-questions': 'use_case_onboarding',
  '/guides/search-slack-and-google-drive-together': 'guide_search_slack_google_drive',
  '/guides/weekly-engineering-updates-from-slack-linear-and-github':
    'guide_weekly_engineering_updates',
  '/guides/connect-sentry-incidents-to-releases-discussions-and-fixes': 'guide_sentry_incidents',
  '/solutions/client-project-handoffs': 'solution_client_project_handoffs',
  '/solutions/weekly-project-updates': 'solution_weekly_project_updates',
  '/solutions/crm-context-from-team-activity': 'solution_crm_context_team_activity',
  '/help': 'help',
  '/help/capture': 'help_capture',
  '/help/billing': 'help_billing',
  '/help/work': 'help_work',
  '/help/documents': 'help_documents',
  '/help/boards': 'help_boards',
  '/help/integrations': 'help_integrations',
  '/help/agents': 'help_agents',
  '/help/objects': 'help_objects',
  '/trust': 'trust',
  '/privacy': 'privacy',
  '/terms': 'terms',
  '/cookies': 'cookies',
} satisfies Readonly<Record<string, PublicSurface>>);

export function classifyPublicAnalyticsPath(
  pathname: string | null | undefined,
): PublicSurface | undefined {
  if (
    !pathname ||
    !pathname.startsWith('/') ||
    pathname.includes('?') ||
    pathname.includes('#') ||
    pathname.includes('\\')
  ) {
    return undefined;
  }
  return Object.hasOwn(PUBLIC_ANALYTICS_ROUTES, pathname)
    ? PUBLIC_ANALYTICS_ROUTES[pathname as keyof typeof PUBLIC_ANALYTICS_ROUTES]
    : undefined;
}
