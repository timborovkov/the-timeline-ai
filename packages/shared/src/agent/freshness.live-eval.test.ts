import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'bun:test';
import { drizzle } from 'drizzle-orm/pglite';

import { askAgent } from '#src/agent/ask.js';
import { embed, embedMany } from '#src/llm/embed.js';
import { createQdrantClient } from '#src/qdrant/client.js';
import { enrichEvidenceContext } from '#src/retrieval/context.js';
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
    const records: {
      id: string;
      source: 'web' | 'email' | 'telegram' | 'slack' | 'meeting' | 'integration';
      date: string;
      text: string;
    }[] = [
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
    records.push(
      {
        id: crypto.randomUUID(),
        source: 'integration',
        date: '2026-11-10T10:00:00Z',
        text: 'Integration release action: Juniper production deployment was completed at revision abc123.',
      },
      {
        id: crypto.randomUUID(),
        source: 'web',
        date: '2026-11-09T10:00:00Z',
        text: 'Authored team note: Juniper release rollback requires the on-call engineer.',
      },
    );
    records.push(
      {
        id: crypto.randomUUID(),
        source: 'telegram',
        date: '2026-11-11T09:30:00Z',
        text: 'Delta review is Thursday. The Delta review planning meeting is scheduled for Thursday.',
      },
      {
        id: crypto.randomUUID(),
        source: 'telegram',
        date: '2026-11-11T09:31:00Z',
        text: 'Actually, Friday.',
      },
    );
    const documentFixtures = [
      {
        name: 'Northstar old announcement',
        text: records[0]?.text ?? '',
        sourceEventId: records[0]?.id ?? null,
        private: false,
      },
      {
        name: 'Northstar correction attachment',
        text: records[2]?.text ?? '',
        sourceEventId: records[2]?.id ?? null,
        private: false,
      },
      {
        name: 'Undated archive',
        text: 'Historical Northstar archive from an unknown source date. The archival launch date was November 18.',
        sourceEventId: null,
        private: false,
      },
      {
        name: 'Shared archive with restricted original',
        text: 'A public Northstar archive summary; the original message is not shared.',
        sourceEventId: records[6]?.id ?? null,
        private: false,
      },
      {
        name: 'Restricted attachment',
        text: 'PRIVATE_FRESHNESS_CANARY Northstar secret document.',
        sourceEventId: null,
        private: true,
      },
    ].map((row) => ({
      ...row,
      id: crypto.randomUUID(),
      versionId: crypto.randomUUID(),
      chunkId: crypto.randomUUID(),
    }));
    const report: Record<string, unknown> = {
      collection,
      revision: process.env.FRESHNESS_EVAL_REVISION ?? process.env.GITHUB_SHA ?? null,
      fixtures: { events: records, documents: documentFixtures },
      scenarios: [],
      timings: null,
    };
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
            JSON.stringify(
              row.id === records[0]?.id
                ? { websiteScanId: crypto.randomUUID() }
                : records.slice(9).some((candidate) => candidate.id === row.id)
                  ? { tg_chat_id: 'delta-review', tg_sender_name: 'Synthetic planner' }
                  : {},
            ),
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
      report.embeddingModel = embeddings.model;
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
      const documentEmbeddings = await embedMany({
        texts: documentFixtures.map((row) => row.text),
      });
      for (const [index, row] of documentFixtures.entries()) {
        const owner = row.private ? otherUserId : userId;
        await pg.query(
          `INSERT INTO documents(id,team_id,file_kind,name,owner_user_id,visibility) VALUES ($1,$2,'document',$3,$4,$5)`,
          [row.id, teamId, row.name, owner, row.private ? 'private' : 'team'],
        );
        await pg.query(
          `INSERT INTO document_versions(id,team_id,document_id,version,object_key,source_event_id,processing_status,created_at) VALUES ($1,$2,$3,1,$4,$5,'embedded',$6)`,
          [
            row.versionId,
            teamId,
            row.id,
            `synthetic/${row.id}`,
            row.sourceEventId,
            now.toISOString(),
          ],
        );
        await pg.query(
          `INSERT INTO document_chunks(id,team_id,document_id,document_version_id,chunk_index,text,token_count) VALUES ($1,$2,$3,$4,0,$5,50)`,
          [row.chunkId, teamId, row.id, row.versionId, row.text],
        );
        await pg.query(`UPDATE documents SET current_version_id=$1 WHERE id=$2`, [
          row.versionId,
          row.id,
        ]);
        const payload = buildSearchHit({
          teamId,
          eventId: row.sourceEventId ?? crypto.randomUUID(),
          score: 0,
          source: 'document',
          occurredAt: now.toISOString(),
          authorUserId: owner,
          visibilityOwnerUserId: owner,
          overrides: {
            source_kind: 'doc_chunk',
            event_id: row.sourceEventId,
            document_id: row.id,
            document_version_id: row.versionId,
            document_chunk_id: row.chunkId,
            file_kind: 'document',
            owner_user_id: owner,
            visibility: row.private ? 'private' : 'team',
            embedding_model: documentEmbeddings.model,
          },
        }).payload;
        await client.upsertVector(row.chunkId, documentEmbeddings.vectors[index] ?? [], payload);
      }
      const db = drizzle(pg);
      const search = client.search.bind(client);
      const scope = withTeam(db as never, teamId, userId, { qdrantSearch: search });
      for (const ranking of ['relevance', 'balanced'] as const) {
        const documents = await scope.documents.searchDocumentChunks({
          query: 'Northstar launch date',
          ranking,
          rankingNow: now,
          limit: 10,
        });
        for (const row of documentFixtures.filter((row) => !row.private))
          expect(documents.some((hit) => hit.documentId === row.id)).toBe(true);
        expect(documents.some((hit) => hit.text.includes('PRIVATE_FRESHNESS_CANARY'))).toBe(false);
        expect(
          documents.find((hit) => hit.documentId === documentFixtures[2]?.id)?.ranking?.dateBasis,
        ).toBe('uploaded');
        expect(
          documents.find((hit) => hit.documentId === documentFixtures[2]?.id)?.ranking
            ?.freshnessBoost,
        ).toBe(ranking === 'balanced' ? 0.01 : 0);
      }
      const deltaHits = await scope.timeline.searchEvents({
        query: 'Delta review planning meeting',
        source: 'telegram',
        limit: 1,
        rankingNow: now,
      });
      expect(deltaHits[0]?.eventId).toBe(records[9]?.id);
      const deltaContext = await enrichEvidenceContext(scope, {
        eventIds: deltaHits.map((hit) => hit.eventId),
      });
      expect(deltaContext.adapterFailures).toEqual([]);
      expect(deltaContext.evidence.some((event) => event.eventId === records[10]?.id)).toBe(true);
      report.conversationExpansion = {
        matched: deltaHits[0]?.eventId,
        expandedCorrection: records[10]?.id,
      };
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
          query: 'Juniper release deployment and rollback',
          required: records.slice(7, 9).map((row) => row.id),
        },
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
          name: 'document_conflict',
          requiredCitationIds: documentFixtures.slice(0, 2).map((row) => row.id),
          question:
            'Use search_documents to compare the Northstar old announcement and correction attachment. Cite both versions. What is accepted and what is pending?',
          required: [/19/, /20/, /pending|awaiting|propos/i, /\[doc:/],
        },
        {
          name: 'website_email',
          requiredCitationIds: records.slice(0, 2).map((row) => row.id),
          question:
            'Use search_timeline to compare the old Northstar website announcement and newer email. What dates do they give and is the change approved?',
          required: [/19/, /20/, /pending|awaiting|propos|not.*approv/i],
        },
        {
          name: 'telegram_correction',
          requiredCitationIds: [records[2]?.id],
          question:
            'Use search_timeline_moments to explain the Northstar Telegram correction. What changed and does it change the current record?',
          required: [/19/, /20/, /pending|awaiting|propos|not.*approv/i],
        },
        {
          name: 'unresolved',
          requiredCitationIds: records.slice(3, 5).map((row) => row.id),
          question:
            'Use search_timeline to compare Juniper support hours from Slack and email. Is there a settled answer?',
          required: [/09|9:00/, /10:00/, /conflict|disagree|unresolved|no.*resol/i],
        },
        {
          name: 'pending',
          requiredCitationIds: [objectId],
          question: `Use retrieve_workspace_context with objectId ${objectId}. What is Northstar's recorded launch date and what change is pending?`,
          required: [/19/, /20/, /pending|awaiting|propos/i],
        },
        {
          name: 'historical',
          requiredCitationIds: [records[0]?.id],
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
          for (const id of scenario.requiredCitationIds) {
            if (!id) throw new Error('Missing required fixture citation');
            expect(result.answer).toContain(id);
          }
          for (const row of documentFixtures.filter((row) => row.private))
            expect(result.answer).not.toContain(row.id);
          expect(result.answer).toMatch(/\[ev:|\[ent:|\[task:/);
          for (const pattern of scenario.required) expect(result.answer).toMatch(pattern);
          (report.scenarios as unknown[]).push({
            name: scenario.name,
            repeat,
            answer: result.answer,
          });
          console.warn(`freshness live: ${scenario.name} ${repeat + 1}/3 passed`);
        }
      expect(await scope.suggestions.acceptSuggestionItem(itemId)).toBe(true);
      const accepted = await enrichEvidenceContext(scope, { objectIds: [objectId] });
      expect(accepted.adapterFailures).toEqual([]);
      expect(accepted.objects[0]?.current.dueAt).toBe('2026-11-20T12:00:00.000Z');
      expect(accepted.objects[0]?.pending).toEqual([]);
      expect(await scope.timeline.getEventWithFacts(records[2]?.id ?? '')).not.toBeNull();
      report.acceptance = { currentDueAt: accepted.objects[0]?.current.dueAt, pending: 0 };
      const rejectedBundleId = crypto.randomUUID();
      const rejectedItemId = crypto.randomUUID();
      await pg.query(
        "INSERT INTO agent_suggestions(id,team_id,source,title,dedupe_key) VALUES ($1,$2,'background','Competing launch date','freshness-reject')",
        [rejectedBundleId, teamId],
      );
      await pg.query(
        "INSERT INTO agent_suggestion_items(id,suggestion_id,team_id,operation,target_kind,target_id,title,dedupe_key,proposed_payload) VALUES ($1,$2,$3,'update','task',$4,'Competing date','freshness-reject',$5)",
        [
          rejectedItemId,
          rejectedBundleId,
          teamId,
          objectId,
          JSON.stringify({ dueAt: '2026-11-21T12:00:00Z' }),
        ],
      );
      await pg.query(
        'INSERT INTO agent_suggestion_evidence(suggestion_id,team_id,raw_event_id,quote) VALUES ($1,$2,$3,$4)',
        [rejectedBundleId, teamId, records[2]?.id, records[2]?.text],
      );
      const competing = await enrichEvidenceContext(scope, { objectIds: [objectId] });
      expect(competing.objects[0]?.pending[0]?.canonical).toBe(false);
      await scope.suggestions.rejectSuggestionItem(rejectedItemId);
      const rejected = await enrichEvidenceContext(scope, { objectIds: [objectId] });
      expect(rejected.objects[0]?.pending).toEqual([]);
      expect(rejected.objects[0]?.current.dueAt).toBe('2026-11-20T12:00:00.000Z');
      expect(await scope.timeline.getEventWithFacts(records[2]?.id ?? '')).not.toBeNull();
      report.rejection = {
        currentDueAt: rejected.objects[0]?.current.dueAt,
        pending: 0,
        sourceRetained: true,
      };

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
