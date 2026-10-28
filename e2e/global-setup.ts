import { chromium, type FullConfig } from '@playwright/test';
import { closeDb } from '@timeline/db';

import { clearSavedAuthStates, signInAndSaveState } from './helpers.js';
import { setupE2eData } from './setup.js';
import { e2eSeedTasks } from './test-data.js';

export default async function globalSetup(config: FullConfig): Promise<void> {
  await clearSavedAuthStates();
  await setupE2eData();
  await closeDb();

  if (process.env.E2E_PROD_SMOKE === '1') return;

  // Compile development routes before timed journeys. Cold compilation also
  // exceeds navigation budgets on Node; production smoke uses built output.
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ baseURL: config.projects[0]?.use.baseURL });
    page.setDefaultTimeout(120_000);
    await signInAndSaveState(page, 'owner', 120_000);
    const taskId = e2eSeedTasks.mobileKanban.id;
    const routes = [
      '/help',
      '/app',
      '/app/timeline',
      '/app/work',
      '/app/tasks',
      '/app/objects',
      '/app/objects/new',
      `/app/objects/${taskId}`,
      '/app/boards',
      `/app/boards/${taskId}`,
      '/app/calendar',
      '/app/documents',
      '/app/documents/captured',
      `/app/documents/${taskId}`,
      '/app/meetings',
      `/app/meetings/${taskId}`,
      '/app/me/connections',
      '/app/approvals',
      '/app/chat',
      '/app/search',
      '/app/sources',
      '/app/team',
      '/app/team/integrations',
      '/app/team/slack',
      '/app/team/telegram',
      '/app/team/reconciliation',
      `/app/team/reconciliation/clusters/${taskId}`,
      '/app/team/jobs',
      '/app/team/mcp-share',
      '/app/team/mcp-servers',
      '/app/team/audit',
      '/api/chat',
      '/api/timeline',
      '/api/team/mcp-keys',
      '/api/mcp/server',
      '/api/onboarding/checklist',
      `/api/team/job-recovery/${taskId}/retry`,
      `/api/team/job-recovery/${taskId}/dismiss`,
      `/api/objects/${taskId}/sections?section=facts`,
      `/api/objects/${taskId}/sections?section=events`,
    ];
    for (const route of routes) {
      const response = await page.request.get(route, { timeout: 120_000 });
      if (response.status() >= 500) {
        throw new Error(`E2E route warmup failed: ${route} (${response.status()})`);
      }
      await response.dispose();
    }
    for (const user of ['admin', 'member', 'nonMember'] as const) {
      const context = await browser.newContext({ baseURL: config.projects[0]?.use.baseURL });
      try {
        const authPage = await context.newPage();
        authPage.setDefaultTimeout(120_000);
        await signInAndSaveState(authPage, user, 120_000);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}
