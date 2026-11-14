import { diagnosticReports, platformAdminAudit, type Db } from '@timeline/db';
import { expect } from '@timeline/test-support';
import { afterAll, beforeAll, beforeEach, describe, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';

import { resetSecretsKeyCacheForTests } from '#src/crypto/secrets.js';
import { diagnosticConversation, DIAGNOSTIC_CONSENT_VERSION } from '#src/diagnostics/contract.js';
import {
  listDiagnosticReports,
  readDiagnosticReport,
  pruneDiagnosticReports,
} from '#src/diagnostics/operator.js';
import { resetEnvForTests } from '#src/env.js';
import { registerOperatorContextResolver } from '#src/platform-admin/runtime.js';
import { withTeam } from '#src/team-scope.js';
import { createResettablePGliteTestDb, type ResettablePGliteTestDb } from '#src/test/pglite.js';

// Reports share only reviewed text. Real DB membership, encryption, audit and expiry protect both teams.
const TEAM = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MEMBER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OPS = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const actor = { userId: OPS, email: 'ops@example.test' };
let testDb: ResettablePGliteTestDb;
let db: Db;
const previousKey = process.env.SECRETS_ENCRYPTION_KEY;
const previousAdmins = process.env.PLATFORM_ADMIN_EMAILS;
beforeAll(async () => {
  process.env.SECRETS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  process.env.PLATFORM_ADMIN_EMAILS = actor.email;
  resetEnvForTests();
  resetSecretsKeyCacheForTests();
  testDb = await createResettablePGliteTestDb(async (pg) => {
    await pg.exec(`INSERT INTO users (id,email,"emailVerified") VALUES ('${OWNER}','owner@example.test',now()),('${MEMBER}','member@example.test',now()),('${OPS}','ops@example.test',now());
  INSERT INTO teams(id,name,slug) VALUES ('${TEAM}','Synthetic A','a'),('${OTHER}','Synthetic B','b');
  INSERT INTO team_members(team_id,user_id,role) VALUES ('${TEAM}','${OWNER}','owner'),('${TEAM}','${MEMBER}','member'),('${OTHER}','${MEMBER}','owner');`);
  });
  db = drizzle(testDb.pg) as unknown as Db;
}, 60000);
beforeEach(async () => {
  await testDb.reset();
  registerOperatorContextResolver(() => Promise.resolve(null));
});
afterAll(async () => {
  registerOperatorContextResolver(() => Promise.resolve(null));
  if (previousKey === undefined) delete process.env.SECRETS_ENCRYPTION_KEY;
  else process.env.SECRETS_ENCRYPTION_KEY = previousKey;
  if (previousAdmins === undefined) delete process.env.PLATFORM_ADMIN_EMAILS;
  else process.env.PLATFORM_ADMIN_EMAILS = previousAdmins;
  resetEnvForTests();
  resetSecretsKeyCacheForTests();
  await testDb.close();
});
async function fixture() {
  const scope = withTeam(db, TEAM, OWNER);
  const session = await scope.objects.createChatSession();
  return {
    scope,
    input: {
      sessionId: session.id,
      description: 'Synthetic answer has the wrong date',
      conversation: 'You: Synthetic question\nAssistant: Synthetic answer',
      consent: true,
      consentVersion: DIAGNOSTIC_CONSENT_VERSION,
    },
  };
}
describe('opt-in diagnostics', () => {
  it('excludes tools, reasoning, system messages, and attachment data from previews', () => {
    expect(
      diagnosticConversation([
        { role: 'system', content: { text: 'hidden prompt' } },
        { role: 'tool', content: { text: 'private source' } },
        {
          role: 'user',
          content: {
            ui_message: {
              parts: [
                { type: 'text', text: 'Question' },
                { type: 'file', url: 'private-file' },
              ],
            },
          },
        },
        {
          role: 'assistant',
          content: {
            ui_message: {
              parts: [
                { type: 'reasoning', text: 'hidden reasoning' },
                { type: 'tool-retrieve', output: 'hidden result' },
                { type: 'text', text: 'Answer' },
              ],
            },
          },
        },
        {
          role: 'assistant',
          content: { text: 'Legacy answer', tool_calls: [{ output: 'hidden result' }] },
        },
      ]),
    ).toBe('You:\nQuestion\n\nAssistant:\nAnswer\n\nAssistant:\nLegacy answer');
  });
  it('requires workspace permission, affirmative current consent and the author’s own session', async () => {
    const { scope, input } = await fixture();
    await expect(scope.diagnostics.submit(input)).rejects.toThrow();
    await expect(withTeam(db, TEAM, MEMBER).diagnostics.configure(true)).rejects.toThrow();
    await scope.diagnostics.configure(true);
    for (const invalid of [
      { ...input, consent: false },
      { ...input, consentVersion: 'old' },
      { ...input, hiddenToolResults: 'secret' },
      { ...input, conversation: 'x'.repeat(60001) },
    ])
      await expect(scope.diagnostics.submit(invalid)).rejects.toThrow();
    await expect(withTeam(db, TEAM, MEMBER).diagnostics.submit(input)).rejects.toThrow();
    await withTeam(db, OTHER, MEMBER).diagnostics.configure(true);
    await expect(withTeam(db, OTHER, MEMBER).diagnostics.submit(input)).rejects.toThrow();
    expect(await db.select().from(diagnosticReports)).toHaveLength(0);
  });
  it('encrypts only the edited submission, audits staff reads, and prevents member access', async () => {
    const { scope, input } = await fixture();
    await scope.diagnostics.configure(true);
    const report = await scope.diagnostics.submit({
      ...input,
      conversation: 'Edited synthetic text',
    });
    const rows = await db.select().from(diagnosticReports);
    expect(JSON.stringify(rows)).not.toContain('Edited synthetic text');
    await expect(
      readDiagnosticReport(db, { userId: OWNER, email: 'owner@example.test' }, report.id),
    ).rejects.toThrow();
    expect(await listDiagnosticReports(db, actor)).toHaveLength(1);
    expect(await db.select().from(platformAdminAudit)).toHaveLength(0);
    const result = await readDiagnosticReport(db, actor, report.id);
    expect(result.conversation).toBe('Edited synthetic text');
    const audits = await db.select().from(platformAdminAudit);
    expect(audits).toHaveLength(1);
    expect(audits[0]?.action).toBe('diagnostics.read');
    expect(JSON.stringify(audits)).not.toContain('Edited synthetic text');
    expect(await withTeam(db, TEAM, MEMBER).diagnostics.list()).toHaveLength(0);
    await withTeam(db, TEAM, MEMBER).diagnostics.remove(report.id);
    expect(await scope.diagnostics.list()).toHaveLength(1);
    await scope.diagnostics.remove(report.id);
    await expect(readDiagnosticReport(db, actor, report.id)).rejects.toThrow();
  });
  it('denies expired reads before cleanup, purges expired ciphertext, preserves current reports', async () => {
    const { scope, input } = await fixture();
    await scope.diagnostics.configure(true);
    const old = await scope.diagnostics.submit(input);
    await scope.diagnostics.submit(input);
    await db
      .update(diagnosticReports)
      .set({ expiresAt: new Date(0) })
      .where(eq(diagnosticReports.id, old.id));
    await expect(readDiagnosticReport(db, actor, old.id)).rejects.toThrow();
    expect(await scope.diagnostics.list()).toHaveLength(1);
    expect(await pruneDiagnosticReports(db)).toBe(1);
    expect(await pruneDiagnosticReports(db)).toBe(0);
    expect(await db.select().from(diagnosticReports)).toHaveLength(1);
  });
  it('denies new reports after disablement, removal, or session archival', async () => {
    const { scope, input } = await fixture();
    await scope.diagnostics.configure(true);
    await scope.diagnostics.configure(false);
    await expect(scope.diagnostics.submit(input)).rejects.toThrow();
    await scope.diagnostics.configure(true);
    await scope.objects.archiveChatSession(input.sessionId);
    await expect(scope.diagnostics.submit(input)).rejects.toThrow();
    await testDb.pg.exec(`UPDATE team_members SET removed_at=now() WHERE user_id='${OWNER}'`);
    await expect(scope.diagnostics.configure(true)).rejects.toThrow();
    await expect(scope.diagnostics.submit(input)).rejects.toThrow();
  });
  it('cannot reset the daily quota by deleting reports', async () => {
    const { scope, input } = await fixture();
    await scope.diagnostics.configure(true);
    for (let i = 0; i < 10; i++) {
      const report = await scope.diagnostics.submit(input);
      await scope.diagnostics.remove(report.id);
    }
    await expect(scope.diagnostics.submit(input)).rejects.toThrow('Daily report limit');
  });
  it('paginates older reports for both the sender and staff', async () => {
    const { scope, input } = await fixture();
    await scope.diagnostics.configure(true);
    const report = await scope.diagnostics.submit(input);
    // Copies are metadata-only pagination fixtures, never read/decrypted.
    await testDb.pg
      .exec(`INSERT INTO diagnostic_reports (id,team_id,user_id,ciphertext,iv,tag,consent_version,created_at,expires_at)
      SELECT gen_random_uuid(),team_id,user_id,ciphertext,iv,tag,consent_version,created_at - n * interval '1 minute',expires_at
      FROM diagnostic_reports CROSS JOIN generate_series(1,100) AS n WHERE id='${report.id}'`);
    const first = await scope.diagnostics.list(1);
    const second = await scope.diagnostics.list(2);
    const third = await scope.diagnostics.list(3);
    expect(first).toHaveLength(51);
    expect(second).toHaveLength(51);
    expect(third).toHaveLength(1);
    expect(
      new Set([...first.slice(0, 50), ...second.slice(0, 50), ...third].map((row) => row.id)).size,
    ).toBe(101);
    expect(await listDiagnosticReports(db, actor, 3)).toHaveLength(1);
    const oldest = third[0];
    if (!oldest) throw new Error('Expected oldest report');
    await scope.diagnostics.remove(oldest.id);
    expect(await scope.diagnostics.list(3)).toHaveLength(0);
  });
  it('blocks report submission under staff impersonation', async () => {
    const { scope, input } = await fixture();
    await scope.diagnostics.configure(true);
    registerOperatorContextResolver(() =>
      Promise.resolve({
        actorUserId: OPS,
        actorEmail: actor.email,
        effectiveUserId: OWNER,
        teamId: TEAM,
        sessionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        readOnly: false,
      }),
    );
    await expect(scope.diagnostics.submit(input)).rejects.toThrow();
  });
});
