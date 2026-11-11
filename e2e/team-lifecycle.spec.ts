import { randomUUID } from 'node:crypto';

import { test, expect } from '@playwright/test';
import { getDb, teams } from '@timeline/db';
import { processTeamLifecycle } from '@timeline/shared/team-lifecycle/processor';
import { eq } from 'drizzle-orm';

import { withE2eDataTransaction } from './cleanup.js';
import { signIn } from './helpers.js';
import { E2E_PREFIX, e2eUsers } from './test-data.js';

test('owner requests deletion; operator restores, retries and verifies permanent cleanup', async ({
  page,
}) => {
  test.setTimeout(180000);
  const teamId = randomUUID();
  const teamName = 'Disposable deletion browser team';
  await withE2eDataTransaction(async (sql) => {
    await sql`INSERT INTO teams (id, name, slug) VALUES (${teamId}, ${teamName}, ${`${E2E_PREFIX}-${teamId}`})`;
    await sql`INSERT INTO team_members (team_id, user_id, role) VALUES (${teamId}, ${e2eUsers.owner.id}, 'owner')`;
  });
  try {
    await signIn(page, e2eUsers.owner.email);
    await page.context().addCookies([
      {
        name: 'tl_active_team',
        value: teamId,
        url: new URL('/', page.url()).toString(),
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    await page.goto('/app/team?section=advanced');
    await page.getByText('Request permanent deletion', { exact: true }).click();
    await page.getByLabel(/Type the team name/).fill(teamName);
    await page.getByLabel('I understand this affects every member and all team content.').check();
    await page.getByRole('button', { name: 'Disable team and request deletion' }).click();
    await expect(page).not.toHaveURL(/section=advanced/);

    await page.context().clearCookies();
    await signIn(page, e2eUsers.nonMember.email);
    await page.goto('/app/admin/teams?status=requested');
    await expect(page.getByText(teamName, { exact: true })).toBeVisible();
    await page.getByRole('link', { name: teamName, exact: true }).click();
    await expect(page.getByLabel('Team ID', { exact: true })).toHaveValue(teamId);
    const restore = page
      .locator('details')
      .filter({ has: page.locator('summary').filter({ hasText: /^Restore access$/ }) });
    await restore.locator('summary').click();
    await restore.getByLabel('Reason', { exact: true }).fill('Owner withdrew synthetic request');
    await restore.getByLabel('I confirm this change').check();
    await restore.getByRole('button', { name: 'Restore access' }).click();
    await expect(page.getByText('Disable team', { exact: true })).toBeVisible();

    const deletion = page
      .locator('details')
      .filter({ has: page.locator('summary').filter({ hasText: /^Permanently delete team$/ }) });
    await deletion.locator('summary').click();
    await deletion.getByLabel(/Type the team name/).fill(teamName);
    await deletion
      .getByLabel('Reason', { exact: true })
      .fill('Synthetic permanent deletion rehearsal');
    await deletion
      .getByLabel('I understand this affects every member and all team content.')
      .check();
    await deletion.getByRole('button', { name: 'Permanently delete team' }).click();
    await expect(page.getByText('Permanent deletion in progress', { exact: true })).toBeVisible();
    let fail = true;
    const io = {
      objects: () => {
        if (fail) return Promise.reject(new Error('Synthetic object-store outage'));
        return Promise.resolve(true);
      },
      vectors: () => Promise.resolve(),
      queues: () => Promise.resolve(true),
    };
    for (let tick = 0; tick < 3; tick++) await processTeamLifecycle(getDb(), io);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Retry cleanup' })).toBeVisible();
    fail = false;
    await page.getByRole('button', { name: 'Retry cleanup' }).click();
    for (let tick = 0; tick < 8; tick++) {
      await processTeamLifecycle(getDb(), io);
      const [team] = await getDb().select().from(teams).where(eq(teams.id, teamId));
      if (team?.lifecycleWork.stage === 'verify')
        await getDb()
          .update(teams)
          .set({ lifecycleWork: { ...team.lifecycleWork, retryAt: new Date(0).toISOString() } })
          .where(eq(teams.id, teamId));
      if (team?.deletedAt) break;
    }
    await page.reload();
    await expect(page.getByText('Active-system data removed', { exact: true })).toBeVisible();
    await expect(page.getByText('Permanently delete team', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Record follow-up' })).toHaveCount(3);
  } finally {
    await withE2eDataTransaction(async (sql) => {
      await sql`ALTER TABLE platform_admin_audit DISABLE TRIGGER platform_admin_audit_immutable`;
      try {
        await sql`DELETE FROM platform_admin_audit WHERE team_id = ${teamId}`;
      } finally {
        await sql`ALTER TABLE platform_admin_audit ENABLE TRIGGER platform_admin_audit_immutable`;
      }
      await sql`SELECT set_config('timeline.lifecycle_cleanup', 'on', true)`;
      await sql`UPDATE teams SET deletion_started_at = COALESCE(deletion_started_at, now()) WHERE id = ${teamId}`;
      await sql`DELETE FROM audit_log WHERE team_id = ${teamId}`;
      await sql`DELETE FROM platform_impersonation_sessions WHERE team_id = ${teamId}`;
      await sql`DELETE FROM teams WHERE id = ${teamId}`;
    });
  }
});
