import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { withE2eDataTransaction } from './cleanup.js';
import { newSignedInContext } from './helpers.js';
import { e2eTeam, e2eUsers } from './test-data.js';

const allowedText = 'Synthetic shared note for the guest access journey';
const publishedTitle = 'Synthetic published milestone';
const publishedText = 'Guest-facing project update';
const internalTitle = 'Internal synthetic project title';
const privateText = 'Synthetic private note for visibility verification';

test('guests can open explicit notes and record snapshots until revocation', async ({
  browser,
  baseURL,
}) => {
  const allowed = randomUUID();
  const secret = randomUUID();
  const record = randomUUID();
  await withE2eDataTransaction(async (sql) => {
    await sql`INSERT INTO entities (id, team_id, type, canonical_name)
      VALUES (${record}, ${e2eTeam.id}, 'project', ${internalTitle})`;
    for (const note of [
      { id: allowed, text: allowedText, visibility: 'team' },
      { id: secret, text: privateText, visibility: 'private' },
    ]) {
      const provenance = JSON.stringify({
        source_snapshot_kind: 'web_text_capture',
        source_snapshot: { content_text: note.text },
      });
      await sql`
        INSERT INTO raw_events (id, team_id, author_user_id, source, content_text, visibility, source_metadata)
        VALUES (${note.id}, ${e2eTeam.id}, ${e2eUsers.owner.id}, 'web', ${note.text}, ${note.visibility}, ${provenance}::jsonb)
      `;
    }
  });

  const owner = await newSignedInContext(browser, 'owner', { baseURL });
  const guest = await newSignedInContext(browser, 'nonMember', { baseURL });
  try {
    const settings = await owner.newPage();
    await settings.goto('/app/team/guests');
    await settings.getByLabel('Guest email').fill(e2eUsers.nonMember.email);
    await settings.getByRole('button', { name: 'Create invitation link' }).click();
    await expect(settings.getByLabel('Invitation link')).toBeVisible();
    const inviteLink = new URL(await settings.getByLabel('Invitation link').inputValue());
    await expect(settings.getByRole('option', { name: privateText })).toHaveCount(0);
    await settings.getByLabel('Workspace note').selectOption(allowed);
    await settings.getByRole('button', { name: 'Share note', exact: true }).click();
    await expect(settings.getByRole('button', { name: 'Unshare' })).toBeVisible();

    await settings.getByText('Publish a task or project snapshot', { exact: true }).click();
    await settings.getByLabel('Workspace task or project').selectOption(record);
    await settings.getByLabel('Title to share').fill(publishedTitle);
    await settings.getByLabel('Text to share').fill(publishedText);
    await settings.getByRole('button', { name: 'Publish snapshot' }).click();
    await expect(settings.getByRole('button', { name: 'Unpublish record' })).toBeVisible();

    const reader = await guest.newPage();
    await reader.goto(inviteLink.pathname);
    await reader.getByRole('button', { name: 'Accept guest access' }).click();
    await expect(reader.getByText(allowedText)).toBeVisible();
    await expect(reader.getByLabel('Question about shared work')).toBeVisible();
    await reader.getByLabel('Search shared work').fill('milestone');
    await reader.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(reader.getByText(publishedTitle)).toBeVisible();
    await expect(reader.getByText(allowedText)).toHaveCount(0);
    await reader.getByRole('link', { name: 'Open record' }).click();
    await expect(reader.getByText(publishedText)).toBeVisible();
    await expect(reader.getByText(internalTitle)).toHaveCount(0);
    await expect(reader.getByLabel('Question about this record')).toBeVisible();
    await reader.getByRole('link', { name: 'All shared work' }).click();
    await reader.getByRole('link', { name: 'Open note' }).click();
    await expect(reader.getByLabel('Question about this note')).toBeVisible();
    const evidenceDir = process.env.GUEST_UI_EVIDENCE_DIR;
    if (evidenceDir) {
      await settings.reload();
      await expect(settings.getByRole('button', { name: 'Unshare' })).toBeVisible();
      await settings.screenshot({ path: `${evidenceDir}/guest-settings.png` });
      await reader.screenshot({ path: `${evidenceDir}/guest-shared-note.png` });
    }

    await reader.goto(`/guest/${e2eTeam.id}?note=${secret}`);
    await expect(reader.getByText(privateText)).toHaveCount(0);
    await expect(reader.getByLabel('Question about this note')).toHaveCount(0);
    await settings.getByRole('button', { name: 'Revoke guest access' }).click();
    await expect(settings.getByText(e2eUsers.nonMember.email, { exact: true })).toHaveCount(0);
    await reader.goto(`/guest/${e2eTeam.id}?note=${allowed}`);
    await expect(reader.getByText(allowedText)).toHaveCount(0);
    await expect(reader.getByLabel('Question about this note')).toHaveCount(0);
    await reader.goto(`/guest/${e2eTeam.id}?record=${record}`);
    await expect(reader.getByText(publishedText)).toHaveCount(0);
  } finally {
    await Promise.all([owner.close(), guest.close()]);
  }
});
