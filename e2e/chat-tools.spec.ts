import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { getDb, closeDb } from '@timeline/db';
import { withTeam } from '@timeline/shared/team-scope';
import { newSignedInPage } from './helpers.js';
import { e2eTeam, e2eUsers } from './test-data.js';

// Verify actual persisted tool parts in the browser; no live model/provider requests.
test.afterAll(async () => {
  await closeDb();
});
test('reloaded chat shows terminal states and restores a pending board approval', async ({
  browser,
}) => {
  const objects = withTeam(getDb(), e2eTeam.id, e2eUsers.owner.id).objects;
  const session = await objects.createChatSession();
  await objects.persistChatTurn(session.id, {
    assistantMessage: {
      id: randomUUID(),
      role: 'assistant',
      parts: [
        {
          type: 'tool-search_boards',
          toolCallId: 'search',
          state: 'output-available',
          input: { query: 'CRM' },
          output: { count: 0 },
        },
        {
          type: 'dynamic-tool',
          toolName: 'external_lookup',
          toolCallId: 'dynamic',
          state: 'output-error',
          input: {},
          errorText: 'Search temporarily unavailable.',
        },
        {
          type: 'tool-execute_object_update',
          toolCallId: 'denied',
          state: 'output-denied',
          input: { field: 'status' },
          approval: { id: 'denied-approval', approved: false },
        },
        {
          type: 'tool-search_boards',
          toolCallId: 'interrupted',
          state: 'input-available',
          input: {},
        },
        {
          type: 'data-tool-history',
          data: { name: 'search_boards', state: 'result-unavailable', input: {} },
        },
        {
          type: 'tool-execute_board_create',
          toolCallId: 'pending',
          state: 'approval-requested',
          input: { name: 'CRM', templateKind: 'pipeline', reason: 'Requested CRM board' },
          approval: { id: 'pending-approval' },
        },
      ],
    },
  });
  const page = await newSignedInPage(browser, 'owner');
  await page.setViewportSize({ width: 1440, height: 1200 });
  await page.goto(`/app/chat?session=${session.id}`);
  for (let pass = 0; pass < 2; pass++) {
    const statuses = page.locator('output > span[aria-hidden="true"]').filter({
      hasText:
        /^(Completed|Unable to complete|Denied|Interrupted|Result unavailable|Approval needed)$/,
    });
    await expect(statuses).toHaveCount(6);
    await expect(statuses.nth(0)).toContainText('Completed');
    await expect(statuses.nth(1)).toContainText('Unable to complete');
    await expect(statuses.nth(2)).toContainText('Denied');
    await expect(statuses.nth(3)).toContainText('Interrupted');
    await expect(statuses.nth(4)).toContainText('Result unavailable');
    await expect(statuses.nth(5)).toContainText('Approval needed');
    await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeVisible();
    await expect(page.getByText(/Qualified \(active\)/)).toBeVisible();
    await expect(page.locator('svg.animate-spin')).toHaveCount(0);
    if (pass === 0) await page.reload();
  }
  await page.screenshot({ path: '/tmp/timeline-chat-tools-browser.png', fullPage: true });
  await page.context().close();
});
