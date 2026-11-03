import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import {
  PUBLIC_ANALYTICS_ROUTES,
  classifyPublicAnalyticsPath,
} from '@/lib/public-analytics-routes';
describe('public analytics route registry', () => {
  it('classifies only reviewed public documents', () => {
    expect(classifyPublicAnalyticsPath('/')).toBe('home');
    expect(classifyPublicAnalyticsPath('/pricing')).toBe('pricing');
    expect(classifyPublicAnalyticsPath('/integrations/google-drive')).toBe(
      'integration_google_drive',
    );
    expect(classifyPublicAnalyticsPath('/help/documents')).toBe('help_documents');
    expect(classifyPublicAnalyticsPath('/guides/search-slack-and-google-drive-together')).toBe(
      'guide_search_slack_google_drive',
    );
    expect(classifyPublicAnalyticsPath('/solutions/client-project-handoffs')).toBe(
      'solution_client_project_handoffs',
    );
    expect(classifyPublicAnalyticsPath('/solutions/weekly-project-updates')).toBe(
      'solution_weekly_project_updates',
    );
    expect(classifyPublicAnalyticsPath('/solutions/crm-context-from-team-activity')).toBe(
      'solution_crm_context_team_activity',
    );
    expect(classifyPublicAnalyticsPath('/use-cases')).toBe('use_cases');
    expect(classifyPublicAnalyticsPath('/compare')).toBe('compare');
    expect(classifyPublicAnalyticsPath('/compare/hubspot')).toBe('compare_hubspot');
    expect(classifyPublicAnalyticsPath('/agents')).toBe('agents');
    expect(classifyPublicAnalyticsPath('/use-cases/work-record')).toBe('use_case_work_record');
    expect(classifyPublicAnalyticsPath('/product-tour')).toBe('product_tour');
    expect(classifyPublicAnalyticsPath('/integrations/telegram')).toBe('integration_telegram');
    expect(Object.keys(PUBLIC_ANALYTICS_ROUTES)).toHaveLength(44);
  });

  it.each([
    '/app',
    '/app/timeline',
    '/sign-in',
    '/sign-up',
    '/help/support',
    '/help/contact',
    '/record',
    '/accept-invite/secret',
    '/verify-email/secret',
    '/forgot-password',
    '/reset-password',
    '/reset-password?token=secret',
    '/legal/accept',
    '/api/auth/session',
    '/integrations/not-reviewed',
    '/help/not-reviewed',
    '/not-found',
    '/privacy/',
    '/privacy?email=private@example.com',
    '/privacy#rights',
  ])('fails closed for %s', (pathname) => {
    expect(classifyPublicAnalyticsPath(pathname)).toBeUndefined();
  });

  it('fails closed when no client pathname is available', () => {
    expect(classifyPublicAnalyticsPath(null)).toBeUndefined();
    expect(classifyPublicAnalyticsPath(undefined)).toBeUndefined();
  });
});
