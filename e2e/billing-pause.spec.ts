import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

import { closeDb } from '@timeline/db';

import { withE2eDataTransaction } from './cleanup.js';
import { newSignedInPage } from './helpers.js';
import { e2eSeedEvents, e2eTeam } from './test-data.js';

test.afterAll(async () => {
  await closeDb();
});

test('a billing pause preserves authorized record access', async ({ browser }) => {
  const page = await newSignedInPage(browser, 'owner');
  try {
    await withE2eDataTransaction(async (sql) => {
      await sql`
        INSERT INTO team_billing_accounts (
          team_id, plan_id, billing_state, spend_cap_cents, team_seat_terms,
          period_started_at, period_ends_at
        ) VALUES (
          ${e2eTeam.id}, 'team', 'read_only', 0,
          '{"paidSeats":3,"highWaterSeats":3,"includedUsageCents":3600}'::jsonb,
          now() - interval '1 day', now() + interval '29 days'
        )
        ON CONFLICT (team_id) DO UPDATE SET
          plan_id = EXCLUDED.plan_id,
          billing_state = EXCLUDED.billing_state,
          spend_cap_cents = EXCLUDED.spend_cap_cents,
          team_seat_terms = EXCLUDED.team_seat_terms,
          period_started_at = EXCLUDED.period_started_at,
          period_ends_at = EXCLUDED.period_ends_at
      `;
    });
    await page.goto('/app/timeline', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(e2eSeedEvents.privateForOwner).first()).toBeVisible();
    await expect(page.getByText(e2eSeedEvents.otherTeam)).toHaveCount(0);

    // The regular E2E chat shortcut bypasses billing. Run this assertion only
    // with the normal Ask route, using the runner's synthetic provider key.
    if (process.env.E2E_DETERMINISTIC_CHAT === '0') {
      const response = await page.request.post('/api/chat', {
        headers: { Origin: new URL(page.url()).origin },
        data: {
          messages: [
            {
              id: randomUUID(),
              role: 'user',
              parts: [{ type: 'text', text: 'What work happened today?' }],
            },
          ],
        },
      });
      expect(response.status()).toBe(402);
      expect(await response.json()).toMatchObject({
        ok: false,
        error: 'usage_limit_reached',
        message: expect.stringContaining('Ask a workspace admin to check Included usage'),
      });
    }
    await page.goto('/app/team?section=billing', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Included usage', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/Metered work is paused for this workspace/)).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('billing-paused.png') });
  } finally {
    await withE2eDataTransaction(async (sql) => {
      await sql`DELETE FROM team_billing_accounts WHERE team_id = ${e2eTeam.id}`;
    });
    await page.context().close();
  }
});
