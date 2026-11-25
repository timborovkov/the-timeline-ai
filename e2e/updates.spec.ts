import { expect, test, type Page } from '@playwright/test';
import {
  billingFreeGrants,
  billingUsageReservations,
  closeDb,
  dailyDigests,
  getDb,
  rawEvents,
} from '@timeline/db';
import { BILLING_EUR_PER_USD, FREE_MONTHLY_USAGE_CENTS } from '@timeline/shared/billing';
import { getDigestPreference, scheduledUpdateWindow } from '@timeline/shared/messaging';
import type { DailyDigestPayload } from '@timeline/shared/messaging/format';
import { withTeam } from '@timeline/shared/team-scope';
import { eq } from 'drizzle-orm';

import { newSignedInPage, signIn } from './helpers.js';
import { e2eOtherTeam, e2eTeam, e2eUsers } from './test-data.js';

function screenshot(page: Page, path: string) {
  return page.screenshot({
    path,
    animations: 'disabled',
    caret: 'initial',
    style: 'nextjs-portal { display: none; }',
  });
}

test('previews, saves and pauses followed-view updates on mobile and desktop', async ({
  browser,
}) => {
  const scope = withTeam(getDb(), e2eTeam.id, e2eUsers.owner.id);
  const id = await scope.savedViews.create({
    title: 'Launch tasks',
    collection: 'tasks',
    targetId: null,
    filters: {},
  });
  if (!id) throw new Error('Could not create the test saved view');
  const page = await newSignedInPage(browser, 'owner');
  try {
    expect(await scope.savedViews.manage(id, { type: 'notify', enabled: true })).toBe(true);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/app');
    const settings = page
      .getByRole('region', { name: 'Workspace brief' })
      .getByRole('link', { name: 'Manage updates' });
    await expect(settings).toBeVisible();
    const screenshots = process.env.UPDATE_SCREENSHOTS_DIR;
    await expect(settings).toHaveAttribute('href', '/app/updates');
    await settings.click();
    await expect(page.getByRole('heading', { name: 'Your schedules' })).toBeVisible();
    await page.goto('/app/updates?legacy=1');
    await expect(page.getByRole('heading', { name: 'Customize updates' })).toBeVisible();
    await page.getByLabel('What to follow').selectOption('saved_views');
    await page.getByLabel('Cadence').selectOption('weekly');
    await page.getByLabel('Delivery').selectOption('app');
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(
      page.getByText('This update includes new matches from the views you follow.'),
    ).toBeVisible();
    if (screenshots) await screenshot(page, `${screenshots}/settings-desktop.png`);
    await page.getByRole('button', { name: 'Save and enable' }).click();
    await expect(
      page.getByText('Weekly overview · Followed saved views only · Home only'),
    ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Pause updates' }).click();
    await expect(page.getByRole('heading', { name: 'Updates paused' })).toBeVisible();
    if (screenshots) await screenshot(page, `${screenshots}/settings-mobile.png`);
    await page.getByRole('button', { name: 'Resume updates' }).click();
    await expect(page.getByRole('heading', { name: 'Active schedule' })).toBeVisible();
    if (screenshots) {
      await page.goto('/app');
      await expect(settings).toBeVisible();
      await screenshot(page, `${screenshots}/home-after.png`);
    }
  } finally {
    await scope.savedViews.manage(id, { type: 'delete' });
    await page.context().close();
    await closeDb();
  }
});

test('opens the requested workspace archive and hands its date range to Ask', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const db = getDb();
  const digestId = crypto.randomUUID();
  const sourceId = crypto.randomUUID();
  const start = '2026-11-16T12:00:00.000Z';
  const end = '2026-11-23T12:00:00.000Z';
  const summary = 'The archive fixture records a confirmed launch date.';
  const sourceHref = `/app/timeline?event=${sourceId}#ev-${sourceId}`;
  const payload = {
    teamName: e2eOtherTeam.name,
    userName: null,
    timezone: 'UTC',
    windowStart: start,
    windowEnd: end,
    summary,
    pendingApprovals: 0,
    eventCount: 1,
    sourceDistribution: { web: 1 },
    objectChangesByType: {},
    newTeamMembers: [],
    tasks: [],
    upcomingCalendar: [],
    evidenceIds: [sourceId],
    links: [{ label: 'Source 1', href: sourceHref }],
  } satisfies DailyDigestPayload;
  await db.insert(rawEvents).values({
    id: sourceId,
    teamId: e2eOtherTeam.id,
    authorUserId: e2eUsers.owner.id,
    source: 'web',
    contentText: 'Fixture source for the confirmed launch date.',
    occurredAt: new Date('2026-11-20T12:00:00.000Z'),
  });
  await db.insert(dailyDigests).values({
    id: digestId,
    teamId: e2eOtherTeam.id,
    userId: e2eUsers.owner.id,
    windowStart: new Date(start),
    windowEnd: new Date(end),
    status: 'generated',
    summary,
    payload,
  });

  const page = await newSignedInPage(browser, 'owner');
  try {
    await page.goto(`/app/digests?digest=${digestId}&team=${e2eOtherTeam.id}`);
    await expect(page.getByRole('heading', { name: 'Open update' })).toBeVisible();
    await page.getByRole('button', { name: 'Switch workspace and open update' }).click();
    await expect(page).toHaveURL(new RegExp(`/app/digests\\?digest=${digestId}$`));
    await expect(page.getByRole('link', { name: 'Source 1' })).toHaveAttribute('href', sourceHref);
    await expect(page.getByText(summary).first()).toBeVisible();

    // Exercise the real browser Ask handoff while keeping the request offline.
    await page.route('**/api/chat', (route) =>
      route.fulfill({ status: 409, json: { error: 'audit_intercept' } }),
    );
    await page.getByRole('link', { name: 'Ask a follow-up' }).click();
    await expect(page).toHaveURL(new RegExp(`/app/chat\\?update=${digestId}$`));
    const question = `What still needs attention from the work between ${start} and ${end}?`;
    const composer = page.getByPlaceholder('Ask the timeline…');
    const send = page.getByRole('button', { name: 'Send', exact: true });
    await expect(composer).toHaveValue(question);
    // The visible server-rendered composer can precede the client event handlers.
    // Confirm real input events reach the controlled composer before clicking Send.
    await expect(async () => {
      await composer.fill('Audit hydration probe');
      await composer.fill('');
      await expect(send).toBeDisabled({ timeout: 750 });
    }).toPass({ timeout: 20_000 });
    await composer.fill(question);
    await expect(send).toBeEnabled();
    const [submitted] = await Promise.all([
      page.waitForRequest(
        (req) => req.method() === 'POST' && new URL(req.url()).pathname === '/api/chat',
        { timeout: 15_000 },
      ),
      send.click(),
    ]);
    const body = JSON.stringify(submitted.postDataJSON());
    expect(body).toContain(sourceId);
    expect(body).toContain(question);
    const cookie = (await page.context().cookies()).find((item) => item.name === 'tl_active_team');
    expect(cookie?.value).toContain(e2eOtherTeam.id);
  } finally {
    await page.context().close();
    await closeDb();
  }
});

test('explains exhausted workspace previews while preserving update history', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const db = getDb();
  const teamId = e2eOtherTeam.id;
  const userId = e2eUsers.owner.id;
  const { timezone, hour } = await getDigestPreference({ db, teamId, userId });
  const window = scheduledUpdateWindow(new Date(), timezone, hour, 'daily');
  const earlierWindow = scheduledUpdateWindow(
    new Date(window.end.getTime() - 1),
    timezone,
    hour,
    'daily',
  );
  const occurredAt = new Date(window.end.getTime() - 60_000);
  const summary = 'Existing briefing remains available after the AI allowance is used.';
  const archiveId = crypto.randomUUID();

  await db
    .insert(billingFreeGrants)
    .values({ userId, assignedTeamId: teamId })
    .onConflictDoNothing();
  const billing = withTeam(db, teamId, userId).billing;
  const initial = await billing.getDashboard();
  expect(initial.account.planId).toBe('free');
  expect(initial.restrictionReason).toBeNull();
  expect(initial.freeRemaining.includedUsageCents).toBe(FREE_MONTHLY_USAGE_CENTS);

  const nativeAiCents = FREE_MONTHLY_USAGE_CENTS * BILLING_EUR_PER_USD;
  await billing.settle({
    operationId: `e2e:updates-preview:${archiveId}`,
    meterId: 'ai',
    nativeUnits: nativeAiCents,
    customerChargeCents: Math.round(nativeAiCents),
  });
  expect((await billing.getDashboard()).freeRemaining.includedUsageCents).toBe(0);
  expect(
    await billing.reserve({
      operationId: `e2e:updates-preview:${archiveId}:probe`,
      meterId: 'ai',
      reservedNativeUnits: 1,
      reservedChargeCents: 1,
    }),
  ).toEqual({ ok: false, code: 'free_allowance_reached' });
  await db.insert(rawEvents).values({
    teamId,
    authorUserId: userId,
    source: 'web',
    contentText: 'The synthetic launch moved to Friday.',
    createdAt: occurredAt,
    occurredAt,
  });
  await db.insert(dailyDigests).values({
    id: archiveId,
    teamId,
    userId,
    windowStart: earlierWindow.start,
    windowEnd: earlierWindow.end,
    status: 'generated',
    summary,
    payload: {
      teamName: e2eOtherTeam.name,
      userName: null,
      timezone,
      summary,
      windowStart: earlierWindow.start.toISOString(),
      windowEnd: earlierWindow.end.toISOString(),
      pendingApprovals: 0,
      eventCount: 0,
      sourceDistribution: {},
      objectChangesByType: {},
      newTeamMembers: [],
      tasks: [],
      upcomingCalendar: [],
      links: [],
    } satisfies DailyDigestPayload,
  });

  const page = await newSignedInPage(browser, 'owner');
  try {
    await page.goto(`/app/digests?digest=${archiveId}&team=${teamId}`);
    await page.getByRole('button', { name: 'Switch workspace and open update' }).click();
    await expect(page.getByText(summary).first()).toBeVisible();
    await page.goto('/app/updates?legacy=1');
    await page.getByLabel('What to follow').selectOption('workspace');
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(
      'This workspace cannot run a summary right now. Previous updates are still available in Update history.',
    );
    await expect(page.getByRole('button', { name: 'Save and enable' })).toHaveCount(0);
    await page.getByRole('link', { name: 'Update history' }).click();
    await expect(page).toHaveURL(/\/app\/digests$/);
    await expect(page.getByText(summary).first()).toBeVisible();
    expect(
      await db
        .select()
        .from(billingUsageReservations)
        .where(eq(billingUsageReservations.teamId, teamId)),
    ).toHaveLength(0);
  } finally {
    await page.context().close();
    await closeDb();
  }
});

test('a member creates independent weekly email and daily Telegram schedules from Home', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 960 });
  await signIn(page, e2eUsers.member.email, 100_000);
  await page.goto('/app');
  const brief = page.getByRole('region', { name: 'Workspace brief' });
  await expect(brief.getByText('Past 3 days')).toBeVisible();
  await brief.getByRole('link', { name: 'Manage updates' }).click();
  await expect(page.getByRole('heading', { name: 'Your schedules' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Daily update' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Edit default' })).toHaveCount(0);

  await page.getByRole('link', { name: 'New update' }).click();
  await page.getByRole('link', { name: 'Weekly recap' }).click();
  await expect(page.getByRole('combobox', { name: 'Frequency' })).toHaveValue('weekly');
  await page.getByLabel('Name', { exact: true }).fill('Friday recap');
  await page.getByRole('combobox', { name: 'Day', exact: true }).selectOption('5');
  await page.getByLabel('Send time').fill('16:30');
  await expect(page.getByLabel('Look back')).toHaveValue('7');
  await expect(page.getByLabel('Deliver to')).toHaveValue('email');
  await expect(page.getByLabel('Level of detail')).toHaveValue('detailed');
  await expect(
    page.getByRole('checkbox', { name: /Include content in the message/ }),
  ).toBeChecked();
  await page.getByRole('button', { name: 'Save schedule' }).click();
  await expect(page.getByText('Every Friday at 16:30 · Email · More context')).toBeVisible();

  await page.getByRole('link', { name: 'New update' }).click();
  await expect(page.getByLabel('Deliver to')).toHaveValue('telegram');
  await page.getByRole('button', { name: 'Save schedule' }).click();
  await expect(page.getByText('Every day at 09:00 · Telegram DM · Quick scan')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Friday recap' })).toBeVisible();

  await page.getByRole('link', { name: 'Edit Daily check-in' }).click();
  await page.getByLabel('Send this update').uncheck();
  await page.getByRole('button', { name: 'Save schedule' }).click();
  await expect(page.getByText('Paused', { exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Update history' }).click();
  await expect(page.getByRole('heading', { name: 'Update history' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app');
  await expect(brief.getByRole('link', { name: 'View timeline' })).toBeVisible();
});
