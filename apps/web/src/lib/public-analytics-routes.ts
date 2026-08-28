import type { PublicSurface } from '@timeline/shared/analytics';

export const PUBLIC_ANALYTICS_ROUTES = Object.freeze({
  '/': 'home',
  '/how-it-works': 'how_it_works',
  '/integrations': 'integrations',
  '/integrations/slack': 'integration_slack',
  '/integrations/github': 'integration_github',
  '/integrations/linear': 'integration_linear',
  '/integrations/google-drive': 'integration_google_drive',
  '/integrations/monday': 'integration_monday',
  '/integrations/sentry': 'integration_sentry',
  '/guides/search-slack-and-google-drive-together': 'guide_search_slack_google_drive',
  '/guides/weekly-engineering-updates-from-slack-linear-and-github':
    'guide_weekly_engineering_updates',
  '/guides/connect-sentry-incidents-to-releases-discussions-and-fixes': 'guide_sentry_incidents',
  '/solutions/client-project-handoffs': 'solution_client_project_handoffs',
  '/solutions/weekly-project-updates': 'solution_weekly_project_updates',
  '/solutions/crm-context-from-team-activity': 'solution_crm_context_team_activity',
  '/help': 'help',
  '/help/capture': 'help_capture',
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
