import { randomUUID } from 'node:crypto';

import {
  type Db,
  websites,
  websiteRuns,
  websitePages,
  websiteNotifications,
  websiteSources,
  billingUsageReservations,
  notifications,
  documents,
  documentVersions,
  documentChunks,
  rawEvents,
} from '@timeline/db';
import { and, desc, eq, getTableColumns, isNull, sql } from 'drizzle-orm';

import { encryptJson } from '#src/crypto/secrets.js';
import { getEnv } from '#src/env.js';

import type { DeferredChatDelivery } from '#src/conversation-surfaces/deferred-delivery.js';
import type { McpAuthPrincipal } from '#src/mcp-server/oauth-core.js';
import type { TeamRole } from '#src/team-scope.js';

import { cancelWebsiteCrawl } from '#src/onboarding/firecrawl-website-scan.js';
import { operatorContext } from '#src/platform-admin/runtime.js';
import { authorizeWebsitePrincipal } from '#src/websites/authorization.js';
import {
  DEFAULT_WEBSITE_SCHEDULE,
  websiteLimits,
  nextWebsiteScan,
  normalizeWebsiteUrl,
  type WebsiteSchedule,
} from '#src/websites/policy.js';

export function createWebsiteScope({
  db,
  teamId,
  userId,
  ensureMember,
  principal,
}: {
  principal?: McpAuthPrincipal;
  db: Db;
  teamId: string;
  userId: string;
  ensureMember: (role?: TeamRole) => Promise<TeamRole>;
}) {
  async function permission(required: 'read' | 'websites:scan' | 'websites:manage') {
    if (principal) await authorizeWebsitePrincipal(db, principal, required);
    const role = await ensureMember(
      required === 'websites:manage' && principal?.authType !== 'api_key' ? 'admin' : 'member',
    );
    if (required === 'websites:manage' && role === 'member' && principal?.authType !== 'api_key')
      throw new Error('Requires admin role');
  }
  const sourceWhere = (id: string) => and(eq(websites.teamId, teamId), eq(websites.id, id));
  const runWhere = (id: string) => and(eq(websiteRuns.teamId, teamId), eq(websiteRuns.id, id));
  async function get(id: string) {
    await permission('read');
    const [row] = await db.select().from(websites).where(sourceWhere(id));
    if (!row) throw new Error('Website not found');
    return row;
  }
  async function getRun(id: string) {
    await permission('read');
    const [row] = await db.select().from(websiteRuns).where(runWhere(id));
    if (!row) throw new Error('Website scan not found');
    const [snapshot] = await db
      .select()
      .from(websiteSources)
      .where(and(eq(websiteSources.teamId, teamId), eq(websiteSources.id, id)));
    const versions = snapshot?.pages
      ? await db
          .select({
            metadata: rawEvents.sourceMetadata,
            eventId: rawEvents.id,
            versionId: documentVersions.id,
            status: documentVersions.processingStatus,
          })
          .from(rawEvents)
          .leftJoin(
            documentVersions,
            and(
              eq(documentVersions.teamId, teamId),
              eq(documentVersions.sourceEventId, rawEvents.id),
            ),
          )
          .where(
            and(
              eq(rawEvents.teamId, teamId),
              sql`${rawEvents.sourceMetadata}->>'websiteScanId' = ${id}`,
            ),
          )
      : [];
    const pageOutcomes = (snapshot?.pages ?? []).map((page) => {
      const capture = versions.find(
        (version) => (version.metadata as Record<string, unknown>).pageUrl === page.url,
      );
      return {
        url: page.url,
        title: page.title,
        eventId: capture?.eventId ?? null,
        versionId: capture?.versionId ?? null,
        status:
          capture?.status === 'embedded'
            ? 'ready'
            : capture
              ? row.finishedAt
                ? 'processing_incomplete'
                : 'processing'
              : row.handoffAt
                ? 'unchanged'
                : 'captured',
      };
    });
    return {
      ...row,
      providerJobId: snapshot?.crawlId ?? null,
      pageOutcomes,
      progress: {
        captured: snapshot?.pages?.length ?? 0,
        ready: pageOutcomes.filter((page) => page.status === 'ready' || page.status === 'unchanged')
          .length,
      },
    };
  }
  return {
    get,
    getRun,
    async prepareLegacyScan(input: {
      scanId: string;
      url: string;
      subject: 'own_team' | 'other_company';
    }) {
      await permission('read');
      return db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${teamId}, 17))`);
        const [existing] = await tx.select().from(websiteRuns).where(runWhere(input.scanId));
        if (existing) return existing;
        const url = normalizeWebsiteUrl(input.url);
        let [source] = await tx
          .select()
          .from(websites)
          .where(
            and(eq(websites.teamId, teamId), eq(websites.url, url), isNull(websites.archivedAt)),
          );
        if (!source)
          [source] = await tx
            .insert(websites)
            .values({
              teamId,
              url,
              hostname: new URL(url).hostname,
              subject: input.subject,
              createdBy: userId,
            })
            .returning();
        if (!source) throw new Error('Website unavailable');
        const [run] = await tx
          .insert(websiteRuns)
          .values({
            id: input.scanId,
            teamId,
            websiteId: source.id,
            requestedBy: userId,
            trigger: 'onboarding',
            idempotencyKey: `legacy:${input.scanId}`,
            billingPolicy: 'legacy',
            unitsPerPage: 1,
            status: 'partial',
          })
          .returning();
        if (!run) throw new Error('Website scan unavailable');
        return run;
      });
    },
    async adoptLegacyScan(scanId: string) {
      await permission('read');
      await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${teamId}, 17))`);
        const [snapshot] = await tx
          .select()
          .from(websiteSources)
          .where(and(eq(websiteSources.teamId, teamId), eq(websiteSources.id, scanId)));
        if (!snapshot?.pages) return;
        const url = normalizeWebsiteUrl(snapshot.url);
        let [source] = await tx
          .select()
          .from(websites)
          .where(
            and(eq(websites.teamId, teamId), eq(websites.url, url), isNull(websites.archivedAt)),
          );
        if (!source)
          [source] = await tx
            .insert(websites)
            .values({
              teamId,
              url,
              hostname: new URL(url).hostname,
              subject: snapshot.websiteSubject,
              createdBy: userId,
            })
            .returning();
        if (!source) throw new Error('Website unavailable');
        await tx
          .insert(websiteRuns)
          .values({
            id: scanId,
            teamId,
            websiteId: source.id,
            requestedBy: userId,
            trigger: 'onboarding',
            idempotencyKey: `legacy:${scanId}`,
            billingPolicy: 'legacy',
            unitsPerPage: 1,
            pageCount: snapshot.pages.length,
            sourceUnits: snapshot.pages.length,
            status: 'partial',
            handoffAt: new Date(),
            changedCount: snapshot.pages.length,
            finishedAt: null,
          })
          .onConflictDoUpdate({
            target: websiteRuns.id,
            set: {
              status: 'partial',
              handoffAt: new Date(),
              changedCount: snapshot.pages.length,
              pageCount: snapshot.pages.length,
              sourceUnits: snapshot.pages.length,
              finishedAt: null,
            },
          });
        const captures = await tx
          .select({ event: rawEvents, document: documents, version: documentVersions })
          .from(rawEvents)
          .innerJoin(
            documents,
            and(
              eq(documents.teamId, teamId),
              eq(documents.sourceRawEventId, rawEvents.id),
              isNull(documents.deletedAt),
            ),
          )
          .innerJoin(
            documentVersions,
            and(
              eq(documentVersions.teamId, teamId),
              eq(documentVersions.id, documents.currentVersionId),
            ),
          )
          .where(
            and(
              eq(rawEvents.teamId, teamId),
              sql`${rawEvents.sourceMetadata}->>'websiteScanId' = ${scanId}`,
            ),
          );
        let allReady = captures.length === snapshot.pages.length;
        for (const capture of captures) {
          const metadata = capture.event.sourceMetadata as Record<string, unknown>;
          if (typeof metadata.pageUrl !== 'string') continue;
          const chunks = await tx
            .select({ embeddedAt: documentChunks.websiteEmbeddedAt })
            .from(documentChunks)
            .where(
              and(
                eq(documentChunks.teamId, teamId),
                eq(documentChunks.documentVersionId, capture.version.id),
              ),
            );
          const ready =
            capture.version.processingStatus === 'embedded' ||
            (chunks.length > 0 && chunks.every((chunk) => chunk.embeddedAt !== null));
          if (!ready) allReady = false;
          const values = {
            teamId,
            websiteId: source.id,
            url: normalizeWebsiteUrl(metadata.pageUrl),
            documentId: capture.document.id,
            ...(ready
              ? {
                  currentEventId: capture.event.id,
                  currentVersionId: capture.version.id,
                  contentHash: capture.version.checksumSha256,
                }
              : {}),
          };
          const [current] = await tx
            .select({ event: rawEvents })
            .from(websitePages)
            .leftJoin(
              rawEvents,
              and(eq(rawEvents.teamId, teamId), eq(rawEvents.id, websitePages.currentEventId)),
            )
            .where(
              and(
                eq(websitePages.teamId, teamId),
                eq(websitePages.websiteId, source.id),
                eq(websitePages.url, values.url),
              ),
            );
          if (current?.event && current.event.createdAt >= capture.event.createdAt) continue;
          await tx
            .insert(websitePages)
            .values(values)
            .onConflictDoUpdate({
              target: [websitePages.teamId, websitePages.websiteId, websitePages.url],
              set: values,
            });
          if (ready)
            await tx
              .update(documentVersions)
              .set({ processingStatus: 'embedded' })
              .where(
                and(
                  eq(documentVersions.teamId, teamId),
                  eq(documentVersions.id, capture.version.id),
                ),
              );
        }
        if (captures.length < snapshot.pages.length)
          await tx
            .update(websiteRuns)
            .set({
              status: 'partial',
              finishedAt: new Date(),
              failureReason: 'capture_unavailable',
            })
            .where(runWhere(scanId));
        if (allReady)
          await tx
            .update(websiteRuns)
            .set({ status: 'completed', finishedAt: new Date() })
            .where(runWhere(scanId));
      });
    },
    async attachNotification(id: string, delivery: DeferredChatDelivery) {
      await getRun(id);
      const encrypted = encryptJson({ ...delivery, principal: { teamId, userId } });
      await db
        .insert(websiteNotifications)
        .values({
          runId: id,
          teamId,
          ciphertext: encrypted.ciphertext.toString('base64'),
          iv: encrypted.iv.toString('base64'),
          tag: encrypted.tag.toString('base64'),
        })
        .onConflictDoNothing();
    },
    async list() {
      await permission('read');
      const latestRun = db
        .select({
          id: websiteRuns.id,
          status: websiteRuns.status,
          createdAt: websiteRuns.createdAt,
          finishedAt: websiteRuns.finishedAt,
          changedCount: websiteRuns.changedCount,
        })
        .from(websiteRuns)
        .where(and(eq(websiteRuns.teamId, teamId), eq(websiteRuns.websiteId, websites.id)))
        .orderBy(desc(websiteRuns.createdAt), desc(websiteRuns.id))
        .limit(1)
        .as('latest_run');
      return db
        .select({
          ...getTableColumns(websites),
          latestRun: {
            id: latestRun.id,
            status: latestRun.status,
            createdAt: latestRun.createdAt,
            finishedAt: latestRun.finishedAt,
            changedCount: latestRun.changedCount,
          },
        })
        .from(websites)
        .leftJoinLateral(latestRun, sql`true`)
        .where(and(eq(websites.teamId, teamId), isNull(websites.archivedAt)))
        .orderBy(desc(websites.createdAt));
    },
    async history(id: string) {
      await get(id);
      return db
        .select()
        .from(websiteRuns)
        .where(and(eq(websiteRuns.teamId, teamId), eq(websiteRuns.websiteId, id)))
        .orderBy(desc(websiteRuns.createdAt))
        .limit(50);
    },
    async add(input: {
      url: string;
      subject: 'own_team' | 'other_company';
      permissionConfirmed: boolean;
    }) {
      await permission('websites:scan');
      if (!input.permissionConfirmed)
        throw new Error('Confirm permission to submit this public website');
      if (!['own_team', 'other_company'].includes(input.subject))
        throw new Error('Invalid website subject');
      const url = normalizeWebsiteUrl(input.url);
      return db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${teamId}, 17))`);
        const current = await tx
          .select()
          .from(websites)
          .where(and(eq(websites.teamId, teamId), isNull(websites.archivedAt)));
        if (current.some((row) => row.url === url)) throw new Error('Website already exists');
        if (current.length >= websiteLimits().sources)
          throw new Error('Website safety limit reached');
        const [row] = await tx
          .insert(websites)
          .values({
            teamId,
            url,
            hostname: new URL(url).hostname,
            subject: input.subject,
            createdBy: userId,
            schedule: DEFAULT_WEBSITE_SCHEDULE,
          })
          .returning();
        if (!row) throw new Error('Website unavailable');
        return row;
      });
    },
    async configure(
      id: string,
      input: { schedule?: WebsiteSchedule; paused?: boolean; archive?: boolean },
    ) {
      await permission('websites:manage');
      const operatorSessionId = (await operatorContext())?.sessionId ?? null;
      const row = await get(id);
      if (row.archivedAt) throw new Error('Website is archived');
      const schedule = input.schedule ?? row.schedule;
      const paused = input.paused ?? row.paused;
      const nextScanAt = paused || input.archive ? null : nextWebsiteScan(schedule, new Date());
      await db
        .update(websites)
        .set({
          schedule,
          scheduleBy: userId,
          scheduleOperatorSessionId: operatorSessionId,
          schedulePrincipal: principal ?? null,
          paused,
          nextScanAt,
          ...(input.archive ? { archivedAt: new Date() } : {}),
        })
        .where(sourceWhere(id));
      if (paused || input.archive) {
        const cancelled = await db
          .update(websiteRuns)
          .set({ status: 'cancelled', finishedAt: new Date() })
          .where(
            and(
              eq(websiteRuns.teamId, teamId),
              eq(websiteRuns.websiteId, id),
              eq(websiteRuns.status, 'queued'),
            ),
          )
          .returning();
        for (const run of cancelled)
          await db
            .update(billingUsageReservations)
            .set({ state: 'released', updatedAt: new Date() })
            .where(
              and(
                eq(billingUsageReservations.teamId, teamId),
                eq(billingUsageReservations.operationId, `website-scan:${run.id}`),
                eq(billingUsageReservations.state, 'reserved'),
              ),
            );
        const active = await db
          .select({ crawlId: websiteSources.crawlId })
          .from(websiteRuns)
          .innerJoin(
            websiteSources,
            and(eq(websiteSources.id, websiteRuns.id), eq(websiteSources.teamId, teamId)),
          )
          .where(
            and(
              eq(websiteRuns.teamId, teamId),
              eq(websiteRuns.websiteId, id),
              eq(websiteRuns.status, 'crawling'),
            ),
          );
        for (const run of active)
          if (run.crawlId && getEnv().FIRECRAWL_API_KEY)
            await cancelWebsiteCrawl(run.crawlId, getEnv().FIRECRAWL_API_KEY ?? '').catch(
              () => undefined,
            );
      }
      return get(id);
    },
    async admit(input: {
      websiteId: string;
      idempotencyKey: string;
      trigger: typeof websiteRuns.$inferInsert.trigger;
      scanId?: string;
    }) {
      await permission('websites:scan');
      if (!input.idempotencyKey || input.idempotencyKey.length > 200)
        throw new Error('Invalid idempotency key');
      const operatorSessionId = (await operatorContext())?.sessionId ?? null;
      return db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${teamId}, 17))`);
        const [existing] = await tx
          .select()
          .from(websiteRuns)
          .where(
            and(
              eq(websiteRuns.teamId, teamId),
              eq(websiteRuns.idempotencyKey, input.idempotencyKey),
            ),
          );
        if (existing) {
          if (existing.websiteId !== input.websiteId || existing.requestedBy !== userId)
            throw new Error('Idempotency key already used');
          return existing;
        }
        const [source] = await tx
          .select()
          .from(websites)
          .where(sourceWhere(input.websiteId))
          .for('update');
        if (!source || source.archivedAt || source.paused)
          throw new Error('Website is unavailable or paused');
        if (
          input.trigger === 'scheduled' &&
          (source.scheduleBy !== userId ||
            source.scheduleOperatorSessionId !== operatorSessionId ||
            source.schedulePrincipal?.keyId !== principal?.keyId ||
            source.schedulePrincipal?.authType !== principal?.authType ||
            !source.nextScanAt ||
            input.idempotencyKey !== `schedule:${source.id}:${source.nextScanAt.toISOString()}`)
        )
          throw new Error('Website schedule changed before admission');
        if (
          source.lastScanAt &&
          source.lastScanAt.getTime() > Date.now() - websiteLimits().cooldownMs
        )
          throw new Error('Wait one hour between website scans');
        const [usage] = await tx
          .select({ pages: sql<number>`count(*)::int * 5` })
          .from(websiteRuns)
          .where(
            and(
              eq(websiteRuns.teamId, teamId),
              sql`${websiteRuns.providerStartedAt} > now() - interval '24 hours'`,
            ),
          );
        if ((usage?.pages ?? 0) + 5 > websiteLimits().dailyPages)
          throw new Error('Daily crawl safety limit reached');
        const [active] = await tx
          .select({ id: websiteRuns.id })
          .from(websiteRuns)
          .where(
            and(
              eq(websiteRuns.teamId, teamId),
              sql`${websiteRuns.status} IN ('queued','crawling','processing')`,
            ),
          )
          .limit(1);
        if (active) throw new Error('A website scan is already active for this team');
        const [run] = await tx
          .insert(websiteRuns)
          .values({
            id: input.scanId ?? randomUUID(),
            teamId,
            websiteId: source.id,
            requestedBy: userId,
            platformOperatorSessionId: operatorSessionId,
            principal: principal ?? null,
            trigger: input.trigger,
            idempotencyKey: input.idempotencyKey,
          })
          .returning();
        await tx.update(websites).set({ lastScanAt: new Date() }).where(sourceWhere(source.id));
        if (!run) throw new Error('Website scan unavailable');
        return run;
      });
    },
    async updateRun(
      id: string,
      patch: Partial<
        Pick<
          typeof websiteRuns.$inferInsert,
          | 'status'
          | 'pageCount'
          | 'changedCount'
          | 'sourceUnits'
          | 'providerCredits'
          | 'estimatedProviderCostEur'
          | 'failureReason'
          | 'finishedAt'
          | 'leaseUntil'
          | 'handoffAt'
          | 'providerFinishedAt'
          | 'providerStartedAt'
        >
      >,
    ) {
      await permission('read');
      await db.update(websiteRuns).set(patch).where(runWhere(id));
      if (patch.status === 'processing' || patch.status === 'completed') {
        const run = await getRun(id);
        await db.update(websites).set({ blockedReason: null }).where(sourceWhere(run.websiteId));
      }
    },
    async block(id: string, reason: string) {
      const run = await getRun(id);
      await db
        .update(websiteRuns)
        .set({ status: 'blocked', failureReason: reason, finishedAt: new Date() })
        .where(runWhere(id));
      const [episode] = await db
        .update(websites)
        .set({ blockedReason: reason })
        .where(and(sourceWhere(run.websiteId), isNull(websites.blockedReason)))
        .returning();
      if (episode && run.requestedBy !== '00000000-0000-0000-0000-000000000000')
        await db.insert(notifications).values({
          teamId,
          userId: run.requestedBy,
          kind: 'connection_attention',
          summary: 'A website scan is blocked. Check billing in Website sources.',
          payload: { href: '/app/connections/websites', websiteId: run.websiteId },
        });
    },
    async claimProvider(id: string): Promise<boolean> {
      await permission('read');
      const source = await get((await getRun(id)).websiteId);
      if (source.paused || source.archivedAt || getEnv().WEBSITE_CRAWLS_DISABLED) return false;
      // Global admission reads only operational counters; no cross-team content leaves this boundary.
      return db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(781239421)`);
        const [run] = await tx.select().from(websiteRuns).where(runWhere(id));
        if (!run || run.finishedAt || (run.leaseUntil && run.leaseUntil.getTime() > Date.now()))
          return false;
        const [teamBusy] = await tx
          .select({ id: websiteRuns.id })
          .from(websiteRuns)
          .where(
            and(
              eq(websiteRuns.teamId, teamId),
              sql`${websiteRuns.id} <> ${id} AND ${websiteRuns.status} IN ('queued','crawling','processing')`,
            ),
          )
          .limit(1);
        if (teamBusy) return false;
        const [capacity] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(websiteRuns)
          .where(
            sql`${websiteRuns.providerStartedAt} IS NOT NULL AND ${websiteRuns.providerFinishedAt} IS NULL AND ${websiteRuns.id} <> ${id}`,
          );
        if ((capacity?.count ?? 0) >= websiteLimits().globalConcurrency) return false;
        const [busyHost] = await tx
          .select({ id: websiteRuns.id })
          .from(websiteRuns)
          .innerJoin(websites, eq(websites.id, websiteRuns.websiteId))
          .where(
            and(
              eq(websites.hostname, source.hostname),
              sql`${websiteRuns.id} <> ${id} AND ((${websiteRuns.providerStartedAt} IS NOT NULL AND ${websiteRuns.providerFinishedAt} IS NULL) OR ${websiteRuns.providerStartedAt} > now() - (${websiteLimits().hostDelayMs} * interval '1 millisecond'))`,
            ),
          )
          .limit(1);
        if (busyHost) return false;
        await tx
          .update(websiteRuns)
          .set({
            status: 'crawling',
            leaseUntil: new Date(Date.now() + 10 * 60_000),
            providerStartedAt: run.providerStartedAt ?? new Date(),
          })
          .where(runWhere(id));
        return true;
      });
    },
    async page(websiteId: string, url: string) {
      await get(websiteId);
      const [row] = await db
        .select({ page: websitePages })
        .from(websitePages)
        .innerJoin(
          documents,
          and(
            eq(documents.teamId, teamId),
            eq(documents.id, websitePages.documentId),
            eq(documents.fileKind, 'captured'),
            eq(documents.visibility, 'team'),
            isNull(documents.deletedAt),
          ),
        )
        .where(
          and(
            eq(websitePages.teamId, teamId),
            eq(websitePages.websiteId, websiteId),
            eq(websitePages.url, url),
          ),
        );
      return row?.page ?? null;
    },
    async savePage(input: {
      websiteId: string;
      url: string;
      documentId: string;
      currentEventId: string;
      currentVersionId: string;
      contentHash: string;
    }) {
      await get(input.websiteId);
      await db
        .insert(websitePages)
        .values({ ...input, teamId })
        .onConflictDoUpdate({
          target: [websitePages.teamId, websitePages.websiteId, websitePages.url],
          set: input,
        });
    },
    async advanceSchedule(id: string, dueAt: Date) {
      const source = await get(id);
      await db
        .update(websites)
        .set({ nextScanAt: nextWebsiteScan(source.schedule, new Date()) })
        .where(and(sourceWhere(id), eq(websites.nextScanAt, dueAt)));
    },
  };
}
