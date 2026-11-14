import { createHash } from 'node:crypto';

import {
  auditLog,
  evaluationTraceProjects,
  rawEvents,
  teams,
  teamMembers,
  type Db,
} from '@timeline/db';
import { expect } from '@timeline/test-support';
import { afterAll, beforeAll, beforeEach, describe, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';

import { resetEnvForTests } from '#src/env.js';
import { EVALUATION_CONSENT_VERSION } from '#src/evaluation-tracing/contract.js';
import {
  createEvaluationCaptureScope,
  pruneEvaluationTraces,
  type EvaluationTransport,
} from '#src/evaluation-tracing/runtime.js';
import { withTeam } from '#src/team-scope.js';
import { createResettablePGliteTestDb, type ResettablePGliteTestDb } from '#src/test/pglite.js';

// Real membership/visibility/transactions protect workspace samples. Only LangSmith is faked;
// these synthetic records must never leave the test process.
const TEAM = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MEMBER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let testDb: ResettablePGliteTestDb;
let db: Db;
const envBefore = { ...process.env };
const sent: string[] = [];
const removed: string[] = [];
const fake: EvaluationTransport = {
  send: (name) => {
    sent.push(name);
    return Promise.resolve();
  },
  remove: (name) => {
    removed.push(name);
    return Promise.resolve();
  },
};
const input = {
  enabled: true,
  sources: ['telegram'],
  consent: true,
  consentVersion: EVALUATION_CONSENT_VERSION,
};
const trace = {
  prompt: 'Synthetic source',
  instructions: 'Extract facts',
  model: 'synthetic-model',
  output: { facts: [] },
};
let eventId = '';
for (let n = 1; n < 1000; n++) {
  const id = `eeeeeeee-eeee-4eee-8eee-${String(n).padStart(12, '0')}`;
  if (createHash('sha256').update(id).digest().readUInt32BE(0) % 10 === 0) {
    eventId = id;
    break;
  }
}
beforeAll(async () => {
  testDb = await createResettablePGliteTestDb(async (pg) => {
    await pg.exec(`INSERT INTO users(id,email) VALUES ('${OWNER}','owner@example.test'),('${MEMBER}','member@example.test');
    INSERT INTO teams(id,name,slug) VALUES ('${TEAM}','Synthetic A','a'),('${OTHER}','Synthetic B','b');
    INSERT INTO team_members(team_id,user_id,role) VALUES ('${TEAM}','${OWNER}','owner'),('${TEAM}','${MEMBER}','member');
    INSERT INTO raw_events(id,team_id,source,content_text,occurred_at,visibility) VALUES ('${eventId}','${TEAM}','telegram','Synthetic source',now(),'team');`);
  });
  db = drizzle(testDb.pg) as unknown as Db;
}, 60000);
beforeEach(async () => {
  await testDb.reset();
  sent.length = 0;
  removed.length = 0;
  process.env.WORKSPACE_EVALUATION_TRACING_READY = 'true';
  process.env.LANGSMITH_API_KEY = 'synthetic-unused';
  process.env.LANGSMITH_WORKSPACE_ID = 'synthetic-workspace';
  resetEnvForTests();
});
afterAll(async () => {
  for (const key of [
    'WORKSPACE_EVALUATION_TRACING_READY',
    'LANGSMITH_API_KEY',
    'LANGSMITH_WORKSPACE_ID',
  ]) {
    if (envBefore[key] === undefined) Reflect.deleteProperty(process.env, key);
    else process.env[key] = envBefore[key];
  }
  resetEnvForTests();
  await testDb.close();
});
function scope() {
  return withTeam(db, TEAM, OWNER);
}
function capture() {
  return createEvaluationCaptureScope(db, TEAM, () => scope().requireMembership(), fake);
}
async function enabled() {
  await scope().evaluationTracing.configure(input);
  return capture();
}

describe('workspace evaluation permission', () => {
  it('defaults off and requires fresh administrator membership and explicit current consent', async () => {
    expect((await scope().evaluationTracing.settings()).preference.enabled).toBe(false);
    expect(await capture().begin([eventId])).toBeNull();
    await expect(withTeam(db, TEAM, MEMBER).evaluationTracing.configure(input)).rejects.toThrow();
    await expect(
      scope().evaluationTracing.configure({ ...input, consent: false }),
    ).rejects.toThrow();
    await expect(
      scope().evaluationTracing.configure({ ...input, consentVersion: 'old' }),
    ).rejects.toThrow();
    await expect(scope().evaluationTracing.configure({ ...input, sources: [] })).rejects.toThrow();
    const cached = scope();
    await cached.requireMembership('admin');
    await db
      .update(teamMembers)
      .set({ removedAt: new Date() })
      .where(eq(teamMembers.userId, OWNER));
    await expect(cached.evaluationTracing.configure(input)).rejects.toThrow();
  });
  it('exports eligible new runs and records only content-free audit and cleanup inventory', async () => {
    const cap = await enabled();
    const ticket = await cap.begin([eventId]);
    expect(ticket).not.toBeNull();
    await cap.finish(ticket, trace);
    expect(sent.length).toBe(1);
    const projects = await db.select().from(evaluationTraceProjects);
    expect(projects.length).toBe(1);
    expect(JSON.stringify(projects)).not.toContain(trace.prompt);
    const audit = await db.select().from(auditLog);
    expect(JSON.stringify(audit)).not.toContain(trace.prompt);
  });
  it('excludes private, restricted, deleted, unselected, missing and other-workspace context', async () => {
    const cap = await enabled();
    for (const visibility of ['private', 'specific_users'] as const) {
      await db.update(rawEvents).set({ visibility }).where(eq(rawEvents.id, eventId));
      expect(await cap.begin([eventId])).toBeNull();
    }
    await db
      .update(rawEvents)
      .set({ visibility: 'team', source: 'email' })
      .where(eq(rawEvents.id, eventId));
    expect(await cap.begin([eventId])).toBeNull();
    await db
      .update(rawEvents)
      .set({ source: 'telegram', sourceMetadata: { deleted: true } })
      .where(eq(rawEvents.id, eventId));
    expect(await cap.begin([eventId])).toBeNull();
    await db
      .update(rawEvents)
      .set({ sourceMetadata: {}, teamId: OTHER })
      .where(eq(rawEvents.id, eventId));
    expect(await cap.begin([eventId])).toBeNull();
    expect(await cap.begin([eventId, OWNER])).toBeNull();
    expect(sent.length).toBe(0);
  });
  it('withdrawal or visibility changes during inference prevent export; disabling needs no acknowledgment', async () => {
    const cap = await enabled();
    const ticket = await cap.begin([eventId]);
    await db.update(rawEvents).set({ visibility: 'private' }).where(eq(rawEvents.id, eventId));
    await cap.finish(ticket, trace);
    expect(sent.length).toBe(0);
    await db.update(rawEvents).set({ visibility: 'team' }).where(eq(rawEvents.id, eventId));
    await scope().evaluationTracing.configure({
      ...input,
      enabled: false,
      consent: false,
      consentVersion: '',
    });
    await cap.finish(ticket, trace);
    expect(sent.length).toBe(0);
    await scope().evaluationTracing.configure(input);
    await cap.finish(ticket, trace);
    expect(sent.length).toBe(0);
  });
  it('includes selected connector sources and rejects unselected context in a mixed packet', async () => {
    await scope().evaluationTracing.configure({
      ...input,
      sources: ['slack', 'github', 'google_drive'],
    });
    const cap = capture();
    for (const provider of ['slack', 'github', 'google_drive']) {
      await db
        .update(rawEvents)
        .set({ source: 'integration', sourceMetadata: { provider } })
        .where(eq(rawEvents.id, eventId));
      expect(await cap.begin([eventId])).not.toBeNull();
    }
    await db.insert(rawEvents).values({
      id: OWNER,
      teamId: TEAM,
      source: 'email',
      visibility: 'team',
      contentText: 'Unselected context',
      occurredAt: new Date(),
    });
    expect(await cap.begin([eventId, OWNER])).toBeNull();
  });
  it('caps attempts at 100 per rolling day, including failed exports', async () => {
    const cap = await enabled();
    await db.insert(auditLog).values(
      Array.from({ length: 100 }, () => ({
        teamId: TEAM,
        action: 'evaluation_tracing.export',
        targetType: 'evaluation_trace',
      })),
    );
    await cap.finish(await cap.begin([eventId]), trace);
    expect(sent.length).toBe(0);
  });
  it('readiness is independently required before and after inference', async () => {
    const cap = await enabled();
    const ticket = await cap.begin([eventId]);
    process.env.WORKSPACE_EVALUATION_TRACING_READY = 'false';
    resetEnvForTests();
    expect(await cap.begin([eventId])).toBeNull();
    await cap.finish(ticket, trace);
    expect(sent.length).toBe(0);
  });
  it('keeps ambiguous uploads in deletion inventory and retries cleanup without blocking other projects', async () => {
    await enabled();
    const cap = createEvaluationCaptureScope(db, TEAM, () => scope().requireMembership(), {
      ...fake,
      send: () => Promise.reject(new Error('sensitive provider text')),
    });
    await cap.finish(await cap.begin([eventId]), trace);
    expect((await db.select().from(evaluationTraceProjects)).length).toBe(1);
    await scope().evaluationTracing.configure({ ...input, enabled: false, consent: false });
    await db.insert(evaluationTraceProjects).values({
      teamId: OTHER,
      name: 'other-synthetic-project',
      endpoint: 'https://api.smith.langchain.com',
      workspaceId: 'synthetic',
      expiresAt: new Date(0),
      reconcileAfter: new Date(0),
    });
    const result = await pruneEvaluationTraces(db, undefined, {
      ...fake,
      remove: (name) => {
        if (name !== 'other-synthetic-project') return Promise.reject(new Error('unavailable'));
        removed.push(name);
        return Promise.resolve();
      },
    });
    expect(result.failed).toBe(1);
    expect(removed).toContain('other-synthetic-project');
    expect((await db.select().from(evaluationTraceProjects)).length).toBe(1);
    await db
      .update(evaluationTraceProjects)
      .set({ reconcileAfter: new Date(0), nextCleanupAt: new Date(0) });
    await pruneEvaluationTraces(db, undefined, fake);
    expect((await db.select().from(evaluationTraceProjects)).length).toBe(0);
  });
  it('reconciles a timed-out upload that appears after the first deletion attempt', async () => {
    await enabled();
    let delayedProject = '';
    const remoteProjects = new Set<string>();
    const delayed: EvaluationTransport = {
      send: (name) => {
        delayedProject = name;
        return Promise.reject(new Error('Timeout before acknowledgment'));
      },
      remove: (name) => {
        remoteProjects.delete(name);
        return Promise.resolve();
      },
    };
    const cap = createEvaluationCaptureScope(db, TEAM, () => scope().requireMembership(), delayed);
    await cap.finish(await cap.begin([eventId]), trace);
    await scope().evaluationTracing.configure({ ...input, enabled: false, consent: false });
    await pruneEvaluationTraces(db, undefined, delayed);
    expect((await db.select().from(evaluationTraceProjects)).length).toBe(1);
    remoteProjects.add(delayedProject); // The timed-out request becomes visible later.
    await db.update(evaluationTraceProjects).set({ nextCleanupAt: new Date(0) });
    await pruneEvaluationTraces(db, undefined, delayed);
    expect(remoteProjects.size).toBe(0);
    await db
      .update(evaluationTraceProjects)
      .set({ nextCleanupAt: new Date(0), reconcileAfter: new Date(0) });
    await pruneEvaluationTraces(db, undefined, delayed);
    expect((await db.select().from(evaluationTraceProjects)).length).toBe(0);
  });
  it('keeps separate cleanup destinations when the LangSmith workspace changes', async () => {
    const cap = await enabled();
    const ticket = await cap.begin([eventId]);
    await cap.finish(ticket, trace);
    process.env.LANGSMITH_WORKSPACE_ID = 'second-synthetic-workspace';
    resetEnvForTests();
    await cap.finish(ticket, trace);
    const projects = await db.select().from(evaluationTraceProjects);
    expect(projects.length).toBe(2);
    expect(new Set(sent).size).toBe(2);
  });
  it('expires projects and stops capture for disabled workspaces', async () => {
    const cap = await enabled();
    await cap.finish(await cap.begin([eventId]), trace);
    await db.update(teams).set({ disabledAt: new Date() }).where(eq(teams.id, TEAM));
    await expect(cap.begin([eventId])).rejects.toThrow('suspended');
    await pruneEvaluationTraces(db, undefined, fake);
    expect(removed.length).toBe(1);
  });
});
