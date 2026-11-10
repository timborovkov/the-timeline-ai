// Opt-in real-provider ingest E2E: Firecrawl -> immutable SQL/S3 documents -> real extraction
// -> cited pending suggestions. Disposable PGlite and a local S3 bucket; no production fixtures.
// Worker dispatch is inline: this tests the ingest chain, not browser/Redis transport or embeddings.
import { randomUUID } from 'node:crypto';
import { loadEnvFile } from 'node:process';
import { PGlite } from '@electric-sql/pglite';
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import {
  type Db,
  teams,
  users,
  teamMembers,
  teamBillingAccounts,
  rawEvents,
  documents,
  documentVersions,
  entities,
  agentSuggestionEvidence,
} from '@timeline/db';
import { getEnv, resetEnvForTests } from '@timeline/shared/env';
import { processWebsiteScanJob } from '@timeline/shared/onboarding';
import { withTeam } from '@timeline/shared/team-scope';
import { listChargeCentsForMeter, runWorkerBilling } from '@timeline/shared/billing';
import { getS3Client, getObjectBuffer } from '@timeline/shared/s3';
import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';
import { drizzle } from 'drizzle-orm/pglite';
import { applyDbMigrations } from '#src/test/pglite.js';
import { processExtractJobForTests } from '#src/workers/extract.js';
import { processSuggestionJobForTests } from '#src/workers/suggestions.js';

if (process.env.WEBSITE_SCAN_LIVE_ENV_FILE) loadEnvFile(process.env.WEBSITE_SCAN_LIVE_ENV_FILE);
const live = process.env.WEBSITE_SCAN_LIVE_EVAL === '1' ? describe : describe.skip;
live('real website scan E2E', () => {
  it('captures public pages as documents and proposes cited company records without creating objects', async () => {
    for (const key of ['FIRECRAWL_API_KEY', 'OPENROUTER_API_KEY'])
      if (!process.env[key]?.trim())
        throw new Error(`${key} is required for the live website test`);
    const endpoint = process.env.WEBSITE_SCAN_LIVE_S3_ENDPOINT ?? 'http://127.0.0.1:9000';
    const parsed = new URL(endpoint);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname))
      throw new Error('Live website test requires local disposable S3 storage');
    const bucket = `website-scan-test-${randomUUID()}`;
    Object.assign(process.env, {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      AUTH_SECRET: 'website-live-test-secret-at-least-32-characters',
      DATABASE_URL: 'postgres://unused:unused@127.0.0.1:5432/unused',
      S3_ENDPOINT: endpoint,
      S3_REGION: 'us-east-1',
      S3_ACCESS_KEY_ID: process.env.WEBSITE_SCAN_LIVE_S3_ACCESS_KEY_ID ?? 'timeline',
      S3_SECRET_ACCESS_KEY:
        process.env.WEBSITE_SCAN_LIVE_S3_SECRET_ACCESS_KEY ?? 'timeline_dev_secret',
      S3_BUCKET_DOCUMENTS: bucket,
      BILLING_CHARGES_ENABLED: 'false',
      LANGSMITH_TRACING: 'false',
    });
    // Never use connected billing/analytics accounts from the caller's environment.
    for (const key of ['POLAR_ACCESS_TOKEN', 'POSTHOG_PROJECT_KEY', 'LANGSMITH_API_KEY'])
      delete process.env[key];
    resetEnvForTests();
    const pg = new PGlite();
    const s3 = getS3Client();
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    try {
      await applyDbMigrations(pg);
      const database = drizzle(pg);
      const db = database as unknown as Db;
      const teamId = randomUUID();
      const userId = randomUUID();
      const scanId = randomUUID();
      await database.insert(users).values({
        id: userId,
        email: `${userId}@example.test`,
        name: 'Website test owner',
        emailVerified: new Date(),
      });
      await database
        .insert(teams)
        .values({ id: teamId, name: 'Website scan test', slug: `scan-${teamId}` });
      await database.insert(teamMembers).values({ teamId, userId, role: 'owner' });
      await database.insert(teamBillingAccounts).values({
        teamId,
        planId: 'payg',
        billingState: 'payg_active',
        securityState: 'normal',
        shadowBilling: true,
        walletBalanceCents: 10000,
      });
      const scope = withTeam(db, teamId, userId);
      const url = process.env.WEBSITE_SCAN_LIVE_URL ?? 'https://thetimeline.cc';
      await scope.onboarding.selectStarterPath('website', {
        websiteUrl: url,
        websiteHost: new URL(url).hostname,
        websiteSubject: 'other_company',
        websiteScanId: scanId,
      });
      const operationId = `website-scan:${scanId}`;
      const reserve = async () =>
        (
          await scope.billing.reserve({
            operationId,
            meterId: 'accepted_sources',
            reservedNativeUnits: 5,
            reservedChargeCents: listChargeCentsForMeter('accepted_sources', 5),
          })
        ).ok;
      expect(await reserve()).toBe(true);
      await processWebsiteScanJob({
        scanId,
        userId,
        firecrawlApiKey: process.env.FIRECRAWL_API_KEY!,
        getFirstRun: () => scope.onboarding.getFirstRun(),
        reserve,
        settle: async (count) => {
          await scope.billing.settle({
            operationId,
            meterId: 'accepted_sources',
            nativeUnits: count,
            customerChargeCents: listChargeCentsForMeter('accepted_sources', count),
          });
        },
        release: async () => {
          await scope.billing.release(operationId);
        },
        getCrawlId: () => scope.onboarding.getWebsiteCrawlId(scanId),
        saveCrawlId: (input) => scope.onboarding.saveWebsiteCrawlId(input),
        getPages: () => scope.onboarding.getWebsiteScanPages(scanId),
        savePages: (input) => scope.onboarding.saveWebsiteScanPages(input),
        saveDocument: (input) => scope.onboarding.saveWebsitePageDocument(input),
        createEvent: (input) => scope.timeline.createEvent(input),
        markScanFailed: (reason, id) => scope.onboarding.markScanFailed(reason, id),
        attachCapture: (input) => scope.onboarding.attachCapture(input),
        enqueueExtract: async (data) => {
          await runWorkerBilling(db, teamId, 'extract', () =>
            processExtractJobForTests({ db }, data, {
              getEnv,
              enqueueEmbedJob: async () => {},
              enqueueObjectSummaryRefresh: async () => {},
              enqueueSuggestionJob: async (job) => {
                await runWorkerBilling(db, teamId, 'suggestions', () =>
                  processSuggestionJobForTests({ db }, job, { getEnv }),
                );
                return { enqueued: true, jobId: null };
              },
            }),
          );
        },
      });
      const events = await database.select().from(rawEvents);
      const pageEvents = events.filter((e) => e.source === 'web');
      expect(pageEvents.length).toBeGreaterThan(0);
      expect(pageEvents.length).toBeLessThanOrEqual(5);
      const docs = await database.select().from(documents);
      const versions = await database.select().from(documentVersions);
      expect(docs.length).toBe(pageEvents.length);
      expect(versions.length).toBe(pageEvents.length);
      for (const version of versions) {
        expect(pageEvents.some((e) => e.id === version.sourceEventId)).toBe(true);
        const bytes = await getObjectBuffer(s3, bucket, version.objectKey);
        expect(bytes.body.length).toBeGreaterThan(80);
      }
      const pending = await scope.suggestions.listPendingSuggestions();
      expect(
        pending
          .flatMap((bundle) => bundle.items)
          .some((item) => item.proposedPayload.type === 'company'),
      ).toBe(true);
      const evidence = await database.select().from(agentSuggestionEvidence);
      expect(evidence.length).toBeGreaterThan(0);
      expect(evidence.every((e) => pageEvents.some((p) => p.id === e.rawEventId))).toBe(true);
      expect(await database.select().from(entities)).toHaveLength(0);
      expect((await scope.onboarding.getFirstRun())?.phase).toBe('record');
    } finally {
      const objects = await s3.send(new ListObjectsV2Command({ Bucket: bucket }));
      if (objects.Contents?.length)
        await s3.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: objects.Contents.map((o) => ({ Key: o.Key! })) },
          }),
        );
      await s3.send(new DeleteBucketCommand({ Bucket: bucket }));
      await pg.close();
    }
  }, 240_000);
});
