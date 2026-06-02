import { Buffer } from 'node:buffer';

import { expect, type Page, test } from '@playwright/test';

import { newSignedInPage, signIn } from './helpers.js';
import { e2eOtherTeam, e2eSeedEvents, e2eTeam, e2eUsers } from './test-data.js';

/**
 * Core product E2E coverage. These tests intentionally cross the real browser,
 * auth, server-action, DB, and RSC boundaries for the workflows that define
 * Timeline's day-one trust: sign-in, team isolation, capture visibility,
 * objects, notes, archive state, saved boards, calendar, and documents.
 */

function literalPattern(value: string): RegExp {
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

async function uploadTextDocument(page: Page, name: string, text: string): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /^Upload$/ }).click();
  const fileChooser = await chooser;
  await fileChooser.setFiles({
    name,
    mimeType: 'text/plain',
    buffer: Buffer.from(text),
  });
  await expect(page.getByRole('status').getByText(name)).toBeVisible();
  await expect(page.getByRole('link', { name: literalPattern(name) })).toBeVisible();
}

test('seeded owner can sign in, switch teams, and sign out', async ({ page }) => {
  await signIn(page, e2eUsers.owner.email);

  await page.goto('/app');
  await expect(page.getByRole('heading', { name: /Home dashboard/i })).toBeVisible();

  await page.getByRole('button', { name: new RegExp(`Switch team.*${e2eTeam.name}`) }).click();
  await expect(page.getByRole('heading', { name: 'Teams', exact: true })).toBeVisible();
  await page.getByRole('button', { name: new RegExp(e2eOtherTeam.name) }).click();
  await expect(page).toHaveURL(/\/app/);
  await expect(page.getByText(`team · ${e2eOtherTeam.name}`)).toBeVisible();
  await page.keyboard.press('Escape');

  const accountButton = page.getByRole('button', { name: 'Account' });
  const signOutItem = page.getByRole('menuitem', { name: 'Sign out' });
  await accountButton.click();
  await expect(signOutItem)
    .toBeVisible({ timeout: 2_000 })
    .catch(async () => {
      await accountButton.click();
      await expect(signOutItem).toBeVisible();
    });
  await signOutItem.click();
  await expect(page).toHaveURL(/\/sign-in/);
});

test('timeline capture enforces team, private, specific-user, and cross-team visibility', async ({
  browser,
}) => {
  const ownerPage = await newSignedInPage(browser, 'owner');
  const teamNote = `E2E team note ${Date.now()}`;

  await ownerPage.goto('/app');
  const capture = ownerPage.getByRole('region', { name: 'Capture' });
  await expect(capture.locator('form[data-capture-ready="true"]')).toBeVisible();
  await capture.getByPlaceholder('What happened?').fill(teamNote);
  await capture.getByRole('button', { name: 'Post' }).click();
  await expect(ownerPage.getByText(teamNote).first()).toBeVisible();

  await ownerPage.goto('/app/timeline');
  await expect(ownerPage.getByText(e2eSeedEvents.privateForOwner).first()).toBeVisible();

  const memberPage = await newSignedInPage(browser, 'member');
  await memberPage.goto('/app/timeline');
  await expect(memberPage.getByText(teamNote).first()).toBeVisible();
  await expect(memberPage.getByText(e2eSeedEvents.privateForOwner)).toHaveCount(0);
  await expect(memberPage.getByText(e2eSeedEvents.specificForMember).first()).toBeVisible();

  const nonMemberPage = await newSignedInPage(browser, 'nonMember');
  await nonMemberPage.goto('/app/timeline');
  await expect(nonMemberPage.getByText(e2eSeedEvents.otherTeam).first()).toBeVisible();
  await expect(nonMemberPage.getByText(teamNote)).toHaveCount(0);
  await expect(nonMemberPage.getByText(e2eSeedEvents.privateForOwner)).toHaveCount(0);

  await ownerPage.context().close();
  await memberPage.context().close();
  await nonMemberPage.context().close();
});

test('owner can create an object, update it, add a note, and archive it', async ({ browser }) => {
  const page = await newSignedInPage(browser, 'owner');
  const objectName = `E2E object ${Date.now()}`;
  const note = `E2E object note ${Date.now()}`;

  await page.goto('/app/objects/new');
  await page.getByLabel('Name').fill(objectName);
  await page.getByRole('button', { name: 'Create object' }).click();
  await expect(page).toHaveURL(/\/app\/objects\/[0-9a-f-]+/);
  await expect(page.getByRole('heading', { name: objectName })).toBeVisible();

  await page.getByLabel('Stage').fill('discovery');
  await page.getByLabel('Stage').blur();
  await expect(page.getByText(/stage: null .* discovery/).first()).toBeVisible();

  await page.getByPlaceholder('Add a note. Each note also lands on the timeline.').fill(note);
  await page.getByRole('button', { name: 'Add note' }).click();
  await expect(page.getByText(note).first()).toBeVisible();

  await page.getByRole('button', { name: 'Archive object' }).click();
  await expect(page.getByRole('button', { name: 'Archived' })).toBeVisible();
  await page.context().close();
});

test('owner can create a board and see matching objects on the board', async ({ browser }) => {
  const page = await newSignedInPage(browser, 'owner');
  const objectName = `E2E board object ${Date.now()}`;
  const boardName = `E2E board ${Date.now()}`;

  await page.goto('/app/objects/new');
  await page.getByLabel('Name').fill(objectName);
  await page.getByRole('button', { name: 'Create object' }).click();
  await expect(page.getByRole('heading', { name: objectName })).toBeVisible();

  await page.goto('/app/boards');
  await page.getByLabel('Name').fill(boardName);
  await page.getByLabel('Filter: type').selectOption('task');
  await page.getByRole('button', { name: 'Create board' }).click();
  await expect(page).toHaveURL(/\/app\/boards\/[0-9a-f-]+/);
  await expect(page.getByText(boardName).first()).toBeVisible();
  await expect(page.getByRole('link', { name: objectName })).toBeVisible();
  await page.context().close();
});

test('calendar events can be created, edited, deleted, and visibility-scoped', async ({
  browser,
}) => {
  const ownerPage = await newSignedInPage(browser, 'owner');
  const memberPage = await newSignedInPage(browser, 'member');
  const stamp = Date.now();
  const teamTitle = `E2E calendar team ${stamp}`;
  const editedTitle = `E2E calendar edited ${stamp}`;
  const privateTitle = `E2E calendar private ${stamp}`;

  await ownerPage.goto('/app/calendar?view=day&date=2026-06-02');
  await expect(ownerPage.getByRole('heading', { name: 'Calendar' })).toBeVisible();
  await ownerPage.getByRole('button', { name: 'New' }).click();
  await expect(ownerPage.getByRole('dialog', { name: 'New event' })).toBeVisible();
  await ownerPage.getByLabel('Title').fill(teamTitle);
  await ownerPage.getByLabel('Start date').fill('2026-06-02');
  await ownerPage.getByLabel('End date (exclusive)').fill('2026-06-03');
  await ownerPage.getByLabel('Location').fill('E2E room');
  await ownerPage.getByRole('button', { name: 'Save' }).click();
  await expect(ownerPage.getByRole('button', { name: new RegExp(teamTitle) })).toBeVisible();

  await ownerPage.getByRole('button', { name: new RegExp(teamTitle) }).click();
  await expect(ownerPage.getByRole('dialog', { name: 'Edit event' })).toBeVisible();
  await ownerPage.getByLabel('Title').fill(editedTitle);
  await ownerPage.getByLabel('Location').fill('E2E edited room');
  await ownerPage.getByRole('button', { name: 'Save' }).click();
  await expect(ownerPage.getByRole('button', { name: new RegExp(editedTitle) })).toBeVisible();
  await expect(ownerPage.getByText('Saved')).toBeVisible();

  await memberPage.goto('/app/calendar?view=day&date=2026-06-02');
  await expect(memberPage.getByRole('button', { name: new RegExp(editedTitle) })).toBeVisible();

  await ownerPage.getByRole('button', { name: 'New' }).click();
  await ownerPage.getByLabel('Title').fill(privateTitle);
  await ownerPage.getByLabel('Start date').fill('2026-06-02');
  await ownerPage.getByLabel('End date (exclusive)').fill('2026-06-03');
  await ownerPage.getByLabel('Visibility').selectOption('private');
  await ownerPage.getByRole('button', { name: 'Save' }).click();
  await expect(ownerPage.getByRole('button', { name: new RegExp(privateTitle) })).toBeVisible();

  await memberPage.reload();
  await expect(memberPage.getByText(privateTitle)).toHaveCount(0);

  await ownerPage.getByRole('button', { name: new RegExp(editedTitle) }).click();
  await expect(ownerPage.getByRole('dialog', { name: 'Edit event' })).toBeVisible();
  await ownerPage.getByRole('button', { name: 'Delete' }).click();
  await expect(ownerPage.getByRole('button', { name: new RegExp(editedTitle) })).toHaveCount(0);

  await ownerPage.context().close();
  await memberPage.context().close();
});

test('documents can be organized, uploaded, renamed, deleted, and visibility-scoped', async ({
  browser,
}) => {
  const ownerPage = await newSignedInPage(browser, 'owner');
  const memberPage = await newSignedInPage(browser, 'member');
  const stamp = Date.now();
  const folderName = `E2E documents ${stamp}`;
  const documentName = `E2E document ${stamp}.txt`;
  const renamedDocumentName = `E2E document renamed ${stamp}.txt`;
  const privateDocumentName = `E2E private document ${stamp}.txt`;
  const teamDocumentName = `E2E team document ${stamp}.txt`;

  await ownerPage.goto('/app/documents');
  await expect(ownerPage.getByPlaceholder('Search document chunks')).toBeVisible();

  ownerPage.once('dialog', async (dialog) => {
    expect(dialog.message()).toBe('Folder name');
    await dialog.accept(folderName);
  });
  await ownerPage.getByRole('button', { name: 'New folder' }).click();
  await expect(ownerPage.getByRole('link', { name: folderName })).toBeVisible();

  await ownerPage.getByRole('link', { name: folderName }).click();
  await expect(ownerPage).toHaveURL(/\/app\/documents\?folder=/);
  await expect(ownerPage.locator('nav').getByText(folderName, { exact: true })).toBeVisible();

  await uploadTextDocument(
    ownerPage,
    documentName,
    `Document body for the E2E upload journey ${stamp}.`,
  );
  await ownerPage.getByRole('link', { name: literalPattern(documentName) }).click();
  await expect(ownerPage.getByText(documentName).first()).toBeVisible();
  await expect(ownerPage.getByText('Version history')).toBeVisible();
  await expect(ownerPage.getByText('v1')).toBeVisible();
  await expect(ownerPage.getByText('current')).toBeVisible();
  await expect(ownerPage.getByText('text/plain')).toBeVisible();

  ownerPage.once('dialog', async (dialog) => {
    expect(dialog.message()).toBe('New name');
    await dialog.accept(renamedDocumentName);
  });
  await ownerPage.getByRole('button', { name: 'Rename' }).click();
  await expect(ownerPage.getByText(renamedDocumentName).first()).toBeVisible();

  await ownerPage.getByRole('link', { name: literalPattern(`Back to /${folderName}`) }).click();
  await expect(
    ownerPage.getByRole('link', { name: literalPattern(renamedDocumentName) }),
  ).toBeVisible();

  await ownerPage.getByRole('link', { name: literalPattern(renamedDocumentName) }).click();
  ownerPage.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('Delete this document?');
    await dialog.accept();
  });
  await ownerPage.getByRole('button', { name: 'Delete' }).click();
  await expect(ownerPage).toHaveURL(/\/app\/documents\?folder=/);
  await expect(ownerPage.getByText(renamedDocumentName)).toHaveCount(0);

  await ownerPage.getByLabel('New item visibility').selectOption('private');
  await uploadTextDocument(
    ownerPage,
    privateDocumentName,
    `Private document body for the E2E upload journey ${stamp}.`,
  );

  await ownerPage.getByLabel('New item visibility').selectOption('team');
  await uploadTextDocument(
    ownerPage,
    teamDocumentName,
    `Team document body for the E2E upload journey ${stamp}.`,
  );

  await memberPage.goto(ownerPage.url());
  await expect(
    memberPage.getByRole('link', { name: literalPattern(teamDocumentName) }),
  ).toBeVisible();
  await expect(memberPage.getByText(privateDocumentName)).toHaveCount(0);
  await memberPage.getByRole('link', { name: literalPattern(teamDocumentName) }).click();
  await expect(memberPage.getByText(teamDocumentName).first()).toBeVisible();
  await expect(memberPage.getByText('v1')).toBeVisible();

  await ownerPage.context().close();
  await memberPage.context().close();
});
