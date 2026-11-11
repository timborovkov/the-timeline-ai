import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'bun:test';
import { drizzle } from 'drizzle-orm/pglite';

import { askAgent } from '#src/agent/ask.js';
import { embed, embedMany } from '#src/llm/embed.js';
import { createQdrantClient } from '#src/qdrant/client.js';
import { withTeam } from '#src/team-scope.js';
import { buildSearchHit } from '#src/test/agent-eval-harness.js';
import { applyDbMigrations } from '#src/test/pglite.js';

// Real embeddings, isolated Qdrant, and real agent answers: supplied vector hits
// cannot establish freshness recall. Only synthetic data; the collection is
// deleted in finally. No production database or collection is used.
const live = process.env.FRESHNESS_LIVE_EVAL === '1' ? describe : describe.skip;
live('freshness end-to-end live evaluation', () => {
  it('retrieves both sides and distinguishes current, proposed, and historical claims', async () => {
    if (!process.env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is required');
    const url = process.env.QDRANT_URL ?? 'http://127.0.0.1:6333';
    if (!['localhost', '127.0.0.1', '::1'].includes(new URL(url).hostname))
      throw new Error('Freshness fixtures require local Qdrant');
    process.env.QDRANT_URL = url;
    const collection = `freshness_eval_${crypto.randomUUID().replaceAll('-', '')}`;
    const pg = new PGlite();
    const teamId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const otherUserId = crypto.randomUUID();
    const objectId = crypto.randomUUID();
    const bundleId = crypto.randomUUID();
    const itemId = crypto.randomUUID();
    const now = new Date('2026-11-11T12:00:00Z');
    const records = [
      {
        id: crypto.randomUUID(),
        source: 'web' as const,
        date: '2026-06-01T09:00:00Z',
        text: 'Northstar launch date is November 19. This is the website announcement.',
      },
      {
        id: crypto.randomUUID(),
        source: 'email' as const,
        date: '2026-11-10T09:00:00Z',
        text: 'Northstar launch: please move the launch from November 19 to November 20. This request needs review.',
      },
      {
        id: crypto.randomUUID(),
        source: 'telegram' as const,
        date: '2026-11-11T09:00:00Z',
        text: 'Northstar launch correction: actually Friday November 20, not Thursday November 19. This is a proposed change; approval is still pending.',
      },
      {
        id: crypto.randomUUID(),
        source: 'slack' as const,
        date: '2026-11-11T10:00:00Z',
        text: 'Juniper support hours are 09:00–17:00 UTC according to the support team. No approved schedule change exists.',
      },
      {
        id: crypto.randomUUID(),
        source: 'email' as const,
        date: '2026-11-10T10:00:00Z',
        text: 'Juniper support hours are 10:00–18:00 UTC according to the sales team. This disagrees with support; no resolution is recorded.',
      },
      {
        id: crypto.randomUUID(),
        source: 'meeting' as const,
        date: '2026-06-02T09:00:00Z',
        text: 'Evergreen recovery policy: keep three backup copies and verify a restore monthly.',
      },
      {
        id: crypto.randomUUID(),
        source: 'telegram' as const,
        date: '2026-11-11T11:00:00Z',
        text: 'PRIVATE_FRESHNESS_CANARY Northstar secret compensation is 999999.',
      },
    ];
    const report: Record<string, unknown> = { collection, scenarios: [], timings: null };
    try {
      await applyDbMigrations(pg);
      await pg.query('INSERT INTO teams(id,slug,name) VALUES ($1,$2,$3)', [
        teamId,
        collection,
        'Synthetic freshness evaluation',
      ]);
      await pg.query(
        "INSERT INTO team_billing_accounts(team_id,plan_id,billing_state,spend_cap_cents,shadow_billing) VALUES ($1,'payg','payg_active',100000,true)",
        [teamId],
      );
      for (const [id, email] of [
        [userId, 'reader@freshness.example'],
        [otherUserId, 'private@freshness.example'],
      ]) {
        await pg.query('INSERT INTO users(id,email,name) VALUES ($1,$2,$3)', [
          id,
          email,
          'Synthetic reviewer',
        ]);
        await pg.query("INSERT INTO team_members(team_id,user_id,role) VALUES ($1,$2,'owner')", [
          teamId,
          id,
        ]);
      }
      await pg.query(
        "INSERT INTO entities(id,team_id,type,canonical_name,due_at) VALUES ($1,$2,'task','Northstar launch','2026-11-19T12:00:00Z')",
        [objectId, teamId],
      );
      for (const row of records) {
        const privateRow = row.text.includes('PRIVATE_FRESHNESS_CANARY');
        await pg.query(
          'INSERT INTO raw_events(id,team_id,author_user_id,visibility_owner_user_id,source,content_text,occurred_at,visibility,source_metadata) VALUES ($1,$2,$3,$3,$4,$5,$6,$7,$8)',
          [
            row.id,
            teamId,
            privateRow ? otherUserId : userId,
            row.source,
            row.text,
            row.date,
            privateRow ? 'private' : 'team',
            JSON.stringify(row.source === 'web' ? { websiteScanId: crypto.randomUUID() } : {}),
          ],
        );
      }
      await pg.query(
        "INSERT INTO agent_suggestions(id,team_id,source,title,dedupe_key) VALUES ($1,$2,'background','Move Northstar launch','freshness')",
        [bundleId, teamId],
      );
      await pg.query(
        "INSERT INTO agent_suggestion_items(id,suggestion_id,team_id,operation,target_kind,target_id,title,dedupe_key,proposed_payload) VALUES ($1,$2,$3,'update','task',$4,'Move launch','freshness',$5)",
        [itemId, bundleId, teamId, objectId, JSON.stringify({ dueAt: '2026-11-20T12:00:00Z' })],
      );
      await pg.query(
        'INSERT INTO agent_suggestion_evidence(suggestion_id,team_id,raw_event_id,quote) VALUES ($1,$2,$3,$4)',
        [bundleId, teamId, records[2]?.id, records[2]?.text],
      );
      for (const row of records.slice(0, 3)) {
        const factId = crypto.randomUUID();
        await pg.query(
          "INSERT INTO facts(id,team_id,raw_event_id,statement,confidence,model_version) VALUES ($1,$2,$3,$4,1,'freshness-fixture')",
          [factId, teamId, row.id, row.text],
        );
        await pg.query(
          "INSERT INTO fact_entities(fact_id,entity_id,role) VALUES ($1,$2,'subject')",
          [factId, objectId],
        );
      }
      const embeddings = await embedMany({ texts: records.map((row) => row.text) });
      const client = createQdrantClient({
        collection,
        vectorSize: embeddings.vectors[0]?.length ?? 1536,
      });
      await client.ensureCollection();
      for (const [index, row] of records.entries()) {
        const privateRow = row.text.includes('PRIVATE_FRESHNESS_CANARY');
        const payload = buildSearchHit({
          teamId,
          eventId: row.id,
          score: 0,
          source: row.source,
          occurredAt: row.date,
          authorUserId: privateRow ? otherUserId : userId,
          visibilityOwnerUserId: privateRow ? otherUserId : userId,
          overrides: {
            visibility: privateRow ? 'private' : 'team',
            embedding_model: embeddings.model,
          },
        }).payload;
        await client.upsertVector(row.id, embeddings.vectors[index] ?? [], payload);
      }
      const db = drizzle(pg);
      const search = client.search.bind(client);
      const scope = withTeam(db as never, teamId, userId, { qdrantSearch: search });
      const query = 'What is the Northstar launch date?';
      const queryVector = (await embed({ text: query })).vector;
      // Warm both policies equally; measure steady-state retrieval, not first-query planning.
      for (let warmup = 0; warmup < 3; warmup++) {
        for (const ranking of ['relevance', 'balanced'] as const)
          await scope.timeline.searchEvents({
            query,
            queryVector,
            ranking,
            rankingNow: now,
            limit: 10,
          });
      }
      const baseline: number[] = [];
      const candidate: number[] = [];
      for (let run = 0; run < 30; run++) {
        for (const ranking of run % 2
          ? (['balanced', 'relevance'] as const)
          : (['relevance', 'balanced'] as const)) {
          const start = performance.now();
          const hits = await scope.timeline.searchEvents({
            query,
            queryVector,
            ranking,
            rankingNow: now,
            limit: 10,
          });
          (ranking === 'balanced' ? candidate : baseline).push(performance.now() - start);
          expect(hits.map((hit) => hit.eventId)).toEqual(
            expect.arrayContaining(records.slice(0, 3).map((row) => row.id)) as string[],
          );
          expect(hits.some((hit) => hit.snippet.includes('PRIVATE_FRESHNESS_CANARY'))).toBe(false);
        }
      }
      const p95 = (values: number[]) =>
        [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1] ?? Infinity;
      report.timings = {
        warmupQueriesPerMode: 3,
        baselineMs: baseline,
        candidateMs: candidate,
        baselineP95: p95(baseline),
        candidateP95: p95(candidate),
        ratio: p95(candidate) / p95(baseline),
      };
      for (const fixture of [
        { query: 'Juniper support hours', required: records.slice(3, 5).map((row) => row.id) },
        { query: 'Evergreen recovery backup policy', required: [records[5]?.id] },
        {
          query: 'Northstar website announcement',
          required: [records[0]?.id],
          from: new Date('2026-06-01'),
          to: new Date('2026-06-03'),
        },
      ]) {
        for (const ranking of ['relevance', 'balanced'] as const) {
          const retrieved = await scope.timeline.searchEvents({
            ...fixture,
            ranking,
            rankingNow: now,
            limit: 10,
          });
          for (const id of fixture.required)
            expect(retrieved.some((hit) => hit.eventId === id)).toBe(true);
        }
      }
      const scenarios = [
        {
          name: 'website_email',
          question:
            'Use search_timeline to compare the old Northstar website announcement and newer email. What dates do they give and is the change approved?',
          required: [/19/, /20/, /pending|awaiting|propos|not.*approv/i],
        },
        {
          name: 'telegram_correction',
          question:
            'Use search_timeline_moments to explain the Northstar Telegram correction. What changed and does it change the current record?',
          required: [/19/, /20/, /pending|awaiting|propos|not.*approv/i],
        },
        {
          name: 'unresolved',
          question:
            'Use search_timeline to compare Juniper support hours from Slack and email. Is there a settled answer?',
          required: [/09|9:00/, /10:00/, /conflict|disagree|unresolved|no.*resol/i],
        },
        {
          name: 'pending',
          question: `Use retrieve_workspace_context with objectId ${objectId}. What is Northstar's recorded launch date and what change is pending?`,
          required: [/19/, /20/, /pending|awaiting|propos/i],
        },
        {
          name: 'historical',
          question:
            'Use search_timeline with from 2026-06-01T00:00:00Z and to 2026-06-03T00:00:00Z. What launch date did the Northstar website announce then?',
          required: [/19/],
        },
      ];
      for (const scenario of scenarios)
        for (let repeat = 0; repeat < 3; repeat++) {
          const toolErrors: string[] = [];
          const result = await askAgent(
            {
              db: db as never,
              teamId,
              userId,
              userName: 'Synthetic reviewer',
              deliverySurface: 'web',
              question: scenario.question,
              maxSteps: 6,
            },
            {
              onToolError: (_error, context) => {
                toolErrors.push(context.tool);
              },
              includeMcpTools: false,
              currentDate: now,
              teamScopeDeps: { qdrantSearch: search },
            },
          );
          expect(toolErrors).toEqual([]);
          expect(result.ok).toBe(true);
          if (!result.ok) throw new Error(`Agent failed: ${result.error}`);
          expect(result.answer).not.toContain('PRIVATE_FRESHNESS_CANARY');
          expect(result.answer).toMatch(/\[ev:|\[ent:|\[task:/);
          for (const pattern of scenario.required) expect(result.answer).toMatch(pattern);
          (report.scenarios as unknown[]).push({
            name: scenario.name,
            repeat,
            answer: result.answer,
          });
          console.warn(`freshness live: ${scenario.name} ${repeat + 1}/3 passed`);
        }
      expect(p95(candidate)).toBeLessThanOrEqual(p95(baseline) * 1.25);
    } finally {
      if (process.env.FRESHNESS_EVAL_REPORT)
        await Bun.write(process.env.FRESHNESS_EVAL_REPORT, JSON.stringify(report, null, 2));
      await pg.close();
      const response = await fetch(`${url}/collections/${collection}`, {
        method: 'DELETE',
        headers: process.env.QDRANT_API_KEY ? { 'api-key': process.env.QDRANT_API_KEY } : {},
      });
      if (!response.ok && response.status !== 404)
        throw new Error(`Fixture cleanup failed: ${response.status}`);
    }
  }, 900_000);
});
