/* eslint-disable no-console -- dev seed CLI output */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  artifactClusters,
  artifactEvidenceAssociations,
  boardItems,
  boardLanes,
  boards,
  closeDb,
  documentChunks,
  documents,
  documentVersions,
  entities,
  entityRelationships,
  taskCategoryAssignments,
  facts,
  factEntities,
  getDb,
  integrationAuditLog,
  integrations,
  integrationSelections,
  integrationSyncState,
  meetings,
  meetingTranscriptChunks,
  messagePreferences,
  providerConnections,
  rawEvents,
  reconciliationEvidence,
  reconciliationOutputs,
  reconciliationRuns,
  teamDigestDestinations,
  teamMembers,
  teamProviderResourceShares,
  teams,
  users,
} from '@timeline/db';
import { encryptJson } from '@timeline/shared/crypto';
import { hashPassword } from '@timeline/shared/passwords';
import { getDocumentsBucket, getS3Client, putObject } from '@timeline/shared/s3';
import { and, eq, inArray, ne, or, sql } from 'drizzle-orm';

import { CORPUS_DOCUMENTS, CORPUS_PEOPLE } from './demo-corpus/index.js';
import { insertExpandedDemoCorpus } from './demo-corpus/insert.js';
import {
  assertDemoSeedEnvironment,
  DEMO_DOCUMENT_BYTE_SIZE,
  DEMO_DOCUMENT_CHECKSUM_SHA256,
  DEMO_DOCUMENT_CONTENT_TYPE,
  DEMO_DOCUMENT_OBJECT_KEY,
  DEMO_DOCUMENT_TEXT,
  DEMO_ENTITIES,
  DEMO_EVENTS,
  DEMO_FACTS,
  DEMO_FIXTURE_VERSION,
  DEMO_IDS,
  DEMO_LOGIN_PASSWORD,
  DEMO_SOURCE_REFS,
  DEMO_TIMES,
} from './demo-fixture.js';
import { seedHeavyAcmeLabs } from './seed-dev-heavy.js';

loadDotEnv(resolve(process.cwd(), '.env'));

const TERMS_VERSION = '2026-06-02';
const PRIVACY_VERSION = '2026-06-02';

const IDS = {
  owner: '10000000-0000-4000-8000-000000000001',
  member: '10000000-0000-4000-8000-000000000002',
  team: '20000000-0000-4000-8000-000000000001',
  githubConnection: '30000000-0000-4000-8000-000000000001',
  linearConnection: '30000000-0000-4000-8000-000000000002',
  githubIntegration: '40000000-0000-4000-8000-000000000001',
  linearIntegration: '40000000-0000-4000-8000-000000000002',
  githubShare: '50000000-0000-4000-8000-000000000001',
  linearShare: '50000000-0000-4000-8000-000000000002',
  githubSelection: '60000000-0000-4000-8000-000000000001',
  linearSelection: '60000000-0000-4000-8000-000000000002',
  githubSyncState: '70000000-0000-4000-8000-000000000001',
  linearSyncState: '70000000-0000-4000-8000-000000000002',
  auditConnected: '80000000-0000-4000-8000-000000000001',
  auditSynced: '80000000-0000-4000-8000-000000000002',
  eventKickoff: '90000000-0000-4000-8000-000000000001',
  eventEmail: '90000000-0000-4000-8000-000000000002',
  eventSlack: '90000000-0000-4000-8000-000000000003',
  eventMeeting: '90000000-0000-4000-8000-000000000004',
  eventGithub: '90000000-0000-4000-8000-000000000005',
  eventLinear: '90000000-0000-4000-8000-000000000006',
  eventGithubReview: '90000000-0000-4000-8000-000000000007',
  eventGithubWorkflowSuccess: '90000000-0000-4000-8000-000000000008',
  eventGithubWorkflowRetry: '90000000-0000-4000-8000-000000000009',
  objectProject: 'a0000000-0000-4000-8000-000000000001',
  objectTask: 'a0000000-0000-4000-8000-000000000002',
  objectDecision: 'a0000000-0000-4000-8000-000000000003',
  objectCompany: 'a0000000-0000-4000-8000-000000000004',
  objectPerson: 'a0000000-0000-4000-8000-000000000005',
  clusterProject: 'e0000000-0000-4000-8000-000000000001',
  clusterTask: 'e0000000-0000-4000-8000-000000000002',
  clusterDecision: 'e0000000-0000-4000-8000-000000000003',
  board: 'b0000000-0000-4000-8000-000000000001',
  laneTodo: 'b0000000-0000-4000-8000-000000000002',
  laneDoing: 'b0000000-0000-4000-8000-000000000003',
  laneDone: 'b0000000-0000-4000-8000-000000000004',
  boardItemTask: 'b0000000-0000-4000-8000-000000000005',
  boardItemDecision: 'b0000000-0000-4000-8000-000000000006',
  factKickoff: 'c0000000-0000-4000-8000-000000000001',
  factEmail: 'c0000000-0000-4000-8000-000000000002',
  factMeeting: 'c0000000-0000-4000-8000-000000000003',
  relationshipProjectTask: 'd0000000-0000-4000-8000-000000000001',
  relationshipProjectDecision: 'd0000000-0000-4000-8000-000000000002',
  taskCategoryAssignment: 'd1000000-0000-4000-8000-000000000001',
  evidenceKickoff: 'f0000000-0000-4000-8000-000000000001',
  evidenceEmail: 'f0000000-0000-4000-8000-000000000002',
  evidenceMeeting: 'f0000000-0000-4000-8000-000000000003',
  associationKickoff: 'f1000000-0000-4000-8000-000000000001',
  associationEmail: 'f1000000-0000-4000-8000-000000000002',
  associationMeeting: 'f1000000-0000-4000-8000-000000000003',
  reconciliationRun: 'a1000000-0000-4000-8000-000000000001',
  outputProject: 'a2000000-0000-4000-8000-000000000001',
  outputTask: 'a2000000-0000-4000-8000-000000000002',
  outputDecision: 'a2000000-0000-4000-8000-000000000003',
} as const;

const now = new Date('2026-06-18T09:00:00.000Z');
async function assertReservedSeedRowsAreCompatible(db: ReturnType<typeof getDb>): Promise<void> {
  const [reservedUsers, reservedTeams, reservedConnections, reservedIntegrations] =
    await Promise.all([
      db
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(
          or(
            inArray(
              users.id,
              CORPUS_PEOPLE.map((person) => person.id),
            ),
            inArray(
              users.email,
              CORPUS_PEOPLE.map((person) => person.email),
            ),
          ),
        ),
      db
        .select({ id: teams.id, slug: teams.slug })
        .from(teams)
        .where(or(eq(teams.id, IDS.team), eq(teams.slug, 'acme-labs'))),
      db
        .select({
          id: providerConnections.id,
          provider: providerConnections.provider,
          externalAccountId: providerConnections.externalAccountId,
        })
        .from(providerConnections)
        .where(
          or(
            inArray(providerConnections.id, [IDS.githubConnection, IDS.linearConnection]),
            and(
              eq(providerConnections.ownerUserId, IDS.owner),
              eq(providerConnections.provider, 'github'),
              eq(providerConnections.externalAccountId, 'github-user-avery-dev'),
            ),
            and(
              eq(providerConnections.ownerUserId, IDS.owner),
              eq(providerConnections.provider, 'linear'),
              eq(providerConnections.externalAccountId, 'linear-org-acme-dev'),
            ),
          ),
        ),
      db
        .select({
          id: integrations.id,
          provider: integrations.provider,
          externalAccountId: integrations.externalAccountId,
        })
        .from(integrations)
        .where(
          or(
            inArray(integrations.id, [IDS.githubIntegration, IDS.linearIntegration]),
            and(
              eq(integrations.teamId, IDS.team),
              eq(integrations.provider, 'github'),
              eq(integrations.externalAccountId, 'github-installation-acme-dev'),
            ),
            and(
              eq(integrations.teamId, IDS.team),
              eq(integrations.provider, 'linear'),
              eq(integrations.externalAccountId, 'linear-org-acme-dev'),
            ),
          ),
        ),
    ]);

  for (const row of reservedUsers) {
    const expected = CORPUS_PEOPLE.find((person) => person.email === row.email);
    if (expected && row.id !== expected.id) {
      throw new Error(
        `Cannot seed: ${row.email} already exists with id ${row.id}. Run pnpm dev:wipe or remove the conflicting dev row first.`,
      );
    }
    const reserved = CORPUS_PEOPLE.find((person) => person.id === row.id);
    if (reserved && row.email !== reserved.email) {
      throw new Error(
        `Cannot seed: reserved user id ${reserved.id} already belongs to ${row.email}.`,
      );
    }
  }

  for (const row of reservedTeams) {
    if (row.slug === 'acme-labs' && row.id !== IDS.team) {
      throw new Error(
        `Cannot seed: acme-labs already exists with id ${row.id}. Run pnpm dev:wipe or remove the conflicting dev row first.`,
      );
    }
    if (row.id === IDS.team && row.slug !== 'acme-labs') {
      throw new Error(`Cannot seed: reserved team id ${IDS.team} already belongs to ${row.slug}.`);
    }
  }

  assertReservedIntegrationRows(
    reservedConnections,
    IDS.githubConnection,
    IDS.linearConnection,
    'provider connection',
  );
  assertReservedIntegrationRows(
    reservedIntegrations,
    IDS.githubIntegration,
    IDS.linearIntegration,
    'integration',
  );
}

function assertReservedIntegrationRows(
  rows: Array<{ id: string; provider: string; externalAccountId: string | null }>,
  expectedGithubId: string,
  expectedLinearId: string,
  label: string,
): void {
  for (const row of rows) {
    const expected =
      row.provider === 'github'
        ? expectedGithubId
        : row.provider === 'linear'
          ? expectedLinearId
          : undefined;
    if (expected && row.id !== expected) {
      throw new Error(
        `Cannot seed: ${label} for ${row.provider}:${row.externalAccountId ?? '(none)'} already exists with id ${row.id}. Run pnpm dev:wipe or remove the conflicting dev row first.`,
      );
    }
  }
}

function demoAssociation(input: {
  id: string;
  clusterId: string;
  evidenceId: string;
  rawEventId: string;
  source: 'email' | 'integration' | 'meeting' | 'slack';
  role: 'blocker' | 'decision' | 'discussion' | 'lifecycle_update' | 'update';
  strength: 'human' | 'provider' | 'structured';
  associationSource: 'authoritative_provider' | 'human' | 'structured_anchor';
  rationale: string;
  dedupeKey: string;
}) {
  return {
    ...input,
    teamId: DEMO_IDS.team,
    sourceRefs: [
      {
        source: input.source,
        rawEventId: input.rawEventId,
        evidenceId: input.evidenceId,
      },
    ],
    visibility: 'team' as const,
    visibilityOwnerUserId: null,
    visibilityUserIds: null,
    visibilityFloor: 'team' as const,
    visibilityFloorOwnerUserId: null,
    visibilityFloorUserIds: null,
    metadata: { fixture_version: DEMO_FIXTURE_VERSION },
  };
}

async function main(): Promise<void> {
  assertDemoSeedEnvironment();
  const heavy = process.argv.includes('--heavy');

  const db = getDb();
  await assertReservedSeedRowsAreCompatible(db);
  const passwordHash = await hashPassword(DEMO_LOGIN_PASSWORD);
  const githubSecret = encryptJson({
    access_token: 'gho_dev_seed_access_token_123',
    refresh_token: 'ghr_dev_seed_refresh_token_123',
    expires_at: '2026-12-31T23:59:59.000Z',
  });
  const linearSecret = encryptJson({
    access_token: 'lin_api_dev_seed_access_token_456',
    refresh_token: 'lin_refresh_dev_seed_refresh_token_456',
    expires_at: '2026-12-31T23:59:59.000Z',
  });

  try {
    await putObject(getS3Client(), {
      bucket: getDocumentsBucket(),
      key: DEMO_DOCUMENT_OBJECT_KEY,
      body: Buffer.from(DEMO_DOCUMENT_TEXT),
      contentType: DEMO_DOCUMENT_CONTENT_TYPE,
    });
    for (const document of CORPUS_DOCUMENTS) {
      await putObject(getS3Client(), {
        bucket: getDocumentsBucket(),
        key: document.objectKey,
        body: document.bytes,
        contentType: document.contentType,
      });
    }

    await db.transaction(async (tx) => {
      await tx
        .insert(users)
        .values([
          {
            id: IDS.owner,
            name: 'Avery Timeline',
            email: 'owner@timeline.dev',
            emailVerified: now,
            passwordHash,
            legalTermsVersion: TERMS_VERSION,
            legalPrivacyVersion: PRIVACY_VERSION,
            legalAcceptedAt: now,
          },
          {
            id: IDS.member,
            name: 'Mika Product',
            email: 'member@timeline.dev',
            emailVerified: now,
            passwordHash,
            legalTermsVersion: TERMS_VERSION,
            legalPrivacyVersion: PRIVACY_VERSION,
            legalAcceptedAt: now,
          },
        ])
        .onConflictDoUpdate({
          target: users.email,
          set: {
            name: sql`excluded.name`,
            emailVerified: sql`excluded."emailVerified"`,
            passwordHash: sql`excluded.password_hash`,
            legalTermsVersion: sql`excluded.legal_terms_version`,
            legalPrivacyVersion: sql`excluded.legal_privacy_version`,
            legalAcceptedAt: sql`excluded.legal_accepted_at`,
            updatedAt: now,
          },
        });

      await tx
        .insert(teams)
        .values({
          id: IDS.team,
          slug: 'acme-labs',
          name: 'Acme Labs',
          inboundEmail: 'acme-labs@inbound.timeline.dev',
          inboundSenderWhitelistEnabled: true,
          inboundSenderWhitelist: [
            ...CORPUS_PEOPLE.map((person) => person.email),
            'elena.park@northstar.example',
            'priya.shah@northwind.example',
            'dana.cole@brightline.example',
            'press@therecord.example',
          ],
        })
        .onConflictDoUpdate({
          target: teams.slug,
          set: {
            name: sql`excluded.name`,
            inboundEmail: sql`excluded.inbound_email`,
            inboundSenderWhitelistEnabled: sql`excluded.inbound_sender_whitelist_enabled`,
            inboundSenderWhitelist: sql`excluded.inbound_sender_whitelist`,
          },
        });

      await tx
        .insert(teamMembers)
        .values([
          { teamId: IDS.team, userId: IDS.owner, role: 'owner' },
          { teamId: IDS.team, userId: IDS.member, role: 'member' },
        ])
        .onConflictDoUpdate({
          target: [teamMembers.teamId, teamMembers.userId],
          set: { role: sql`excluded.role`, removedAt: null, removedByUserId: null },
        });

      await tx
        .insert(messagePreferences)
        .values([
          {
            teamId: IDS.team,
            userId: IDS.owner,
            dailyDigestEnabled: false,
            dailyDigestHour: 12,
            timezone: 'UTC',
          },
          {
            teamId: IDS.team,
            userId: IDS.member,
            dailyDigestEnabled: false,
            dailyDigestHour: 12,
            timezone: 'UTC',
          },
        ])
        .onConflictDoUpdate({
          target: [messagePreferences.teamId, messagePreferences.userId],
          targetWhere: sql`${messagePreferences.teamId} IS NOT NULL AND ${messagePreferences.userId} IS NOT NULL`,
          set: {
            dailyDigestEnabled: sql`excluded.daily_digest_enabled`,
            dailyDigestHour: sql`excluded.daily_digest_hour`,
            timezone: sql`excluded.timezone`,
            updatedAt: now,
          },
        });

      await tx
        .insert(teamDigestDestinations)
        .values({
          teamId: IDS.team,
          kind: 'email_members',
          enabled: true,
        })
        .onConflictDoNothing();

      await tx
        .insert(providerConnections)
        .values([
          {
            id: IDS.githubConnection,
            ownerUserId: IDS.owner,
            provider: 'github',
            displayName: 'Avery GitHub',
            externalAccountId: 'github-user-avery-dev',
            scopes: ['repo', 'read:org'],
            authSecretCiphertext: githubSecret.ciphertext,
            authSecretIv: githubSecret.iv,
            authSecretTag: githubSecret.tag,
            lastConnectedAt: now,
          },
          {
            id: IDS.linearConnection,
            ownerUserId: IDS.owner,
            provider: 'linear',
            displayName: 'Acme Linear',
            externalAccountId: 'linear-org-acme-dev',
            scopes: ['read', 'issues:create'],
            authSecretCiphertext: linearSecret.ciphertext,
            authSecretIv: linearSecret.iv,
            authSecretTag: linearSecret.tag,
            lastConnectedAt: now,
          },
        ])
        .onConflictDoUpdate({
          target: providerConnections.id,
          set: {
            displayName: sql`excluded.display_name`,
            scopes: sql`excluded.scopes`,
            authSecretCiphertext: sql`excluded.auth_secret_ciphertext`,
            authSecretIv: sql`excluded.auth_secret_iv`,
            authSecretTag: sql`excluded.auth_secret_tag`,
            lastConnectedAt: sql`excluded.last_connected_at`,
            updatedAt: now,
          },
        });

      await tx
        .insert(integrations)
        .values([
          {
            id: IDS.githubIntegration,
            teamId: IDS.team,
            connectedByUserId: IDS.owner,
            providerConnectionId: IDS.githubConnection,
            provider: 'github',
            displayName: 'GitHub: timborovkov/the-timeline-ai',
            externalAccountId: 'github-installation-acme-dev',
            scopes: ['repo', 'read:org'],
            authSecretCiphertext: githubSecret.ciphertext,
            authSecretIv: githubSecret.iv,
            authSecretTag: githubSecret.tag,
            visibilityDefault: 'team',
            enabled: false,
            lastError: null,
            lastSyncedAt: new Date('2026-06-18T08:40:00.000Z'),
          },
          {
            id: IDS.linearIntegration,
            teamId: IDS.team,
            connectedByUserId: IDS.owner,
            providerConnectionId: IDS.linearConnection,
            provider: 'linear',
            displayName: 'Linear: Acme Roadmap',
            externalAccountId: 'linear-org-acme-dev',
            scopes: ['read', 'issues:create'],
            authSecretCiphertext: linearSecret.ciphertext,
            authSecretIv: linearSecret.iv,
            authSecretTag: linearSecret.tag,
            visibilityDefault: 'team',
            enabled: false,
            lastError: null,
            lastSyncedAt: new Date('2026-06-18T08:45:00.000Z'),
          },
        ])
        .onConflictDoUpdate({
          target: integrations.id,
          set: {
            displayName: sql`excluded.display_name`,
            scopes: sql`excluded.scopes`,
            authSecretCiphertext: sql`excluded.auth_secret_ciphertext`,
            authSecretIv: sql`excluded.auth_secret_iv`,
            authSecretTag: sql`excluded.auth_secret_tag`,
            visibilityDefault: sql`excluded.visibility_default`,
            enabled: sql`excluded.enabled`,
            lastError: null,
            lastSyncedAt: sql`excluded.last_synced_at`,
            updatedAt: now,
          },
        });

      await tx
        .insert(teamProviderResourceShares)
        .values([
          {
            id: IDS.githubShare,
            teamId: IDS.team,
            providerConnectionId: IDS.githubConnection,
            resourceKind: 'github.repo',
            externalId: 'timborovkov/the-timeline-ai',
            externalLabel: 'timborovkov/the-timeline-ai',
          },
          {
            id: IDS.linearShare,
            teamId: IDS.team,
            providerConnectionId: IDS.linearConnection,
            resourceKind: 'linear.team',
            externalId: 'LIN-TL',
            externalLabel: 'Timeline App',
          },
        ])
        .onConflictDoNothing();

      await tx
        .insert(integrationSelections)
        .values([
          {
            id: IDS.githubSelection,
            integrationId: IDS.githubIntegration,
            resourceShareId: IDS.githubShare,
            selectionKind: 'github.repo',
            externalId: 'timborovkov/the-timeline-ai',
            externalLabel: 'timborovkov/the-timeline-ai',
            visibility: 'team',
          },
          {
            id: IDS.linearSelection,
            integrationId: IDS.linearIntegration,
            resourceShareId: IDS.linearShare,
            selectionKind: 'linear.team',
            externalId: 'LIN-TL',
            externalLabel: 'Timeline App',
            visibility: 'team',
          },
        ])
        .onConflictDoNothing();

      await tx
        .insert(integrationSyncState)
        .values([
          {
            id: IDS.githubSyncState,
            integrationId: IDS.githubIntegration,
            resourceType: 'github.pull_requests',
            cursor: { since: '2026-06-18T08:40:00.000Z' },
            lastRunAt: new Date('2026-06-18T08:40:00.000Z'),
            lastStatus: 'ok',
          },
          {
            id: IDS.linearSyncState,
            integrationId: IDS.linearIntegration,
            resourceType: 'linear.issues',
            cursor: { updatedAfter: '2026-06-18T08:45:00.000Z' },
            lastRunAt: new Date('2026-06-18T08:45:00.000Z'),
            lastStatus: 'ok',
          },
        ])
        .onConflictDoNothing();

      await tx
        .insert(rawEvents)
        .values([
          {
            id: IDS.eventKickoff,
            teamId: IDS.team,
            authorUserId: IDS.owner,
            source: 'web',
            contentText:
              'Kickoff note: Acme Labs is launching Project Atlas to unify customer timelines before the July beta.',
            occurredAt: new Date('2026-06-17T09:00:00.000Z'),
            visibility: 'team',
            sourceMetadata: {
              seed: true,
              surface: 'manual_note',
              source_payload_ref: 'inline://timeline/dev-seed/manual-note/project-atlas-kickoff',
              payload_digest: 'sha256:dev-seed-kickoff-note-payload',
            },
          },
          {
            id: IDS.eventEmail,
            teamId: IDS.team,
            authorUserId: IDS.member,
            source: 'email',
            contentText:
              'Email from Mika: Vendor contract review is due Friday, and the security appendix still needs approval.',
            occurredAt: new Date('2026-06-17T11:15:00.000Z'),
            visibility: 'team',
            sourceMetadata: {
              seed: true,
              message_id: 'dev-seed-email-contract-001',
              from: 'member@timeline.dev',
              subject: 'Vendor contract review',
              source_payload_ref: 'inline://timeline/dev-seed/email/vendor-security-contract',
              payload_digest: 'sha256:dev-seed-vendor-security-email-payload',
            },
          },
          {
            id: IDS.eventSlack,
            teamId: IDS.team,
            authorUserId: IDS.owner,
            source: 'slack',
            contentText:
              'Slack #product: Avery confirmed that Atlas beta onboarding should prioritize importer reliability over dashboards.',
            occurredAt: new Date('2026-06-17T14:20:00.000Z'),
            visibility: 'team',
            sourceMetadata: {
              seed: true,
              slack_event_id: 'EvDEVSEED0001',
              channel: '#product',
              slack_channel_name: '#product',
              thread_ts: '1781706000.000100',
            },
          },
          {
            id: IDS.eventMeeting,
            teamId: IDS.team,
            authorUserId: IDS.owner,
            source: 'meeting',
            contentText:
              'Meeting transcript summary: the team decided to keep Recall.ai bots transcript-only and consent-gated for the beta.',
            occurredAt: new Date('2026-06-18T07:30:00.000Z'),
            visibility: 'team',
            sourceMetadata: {
              seed: true,
              platform: 'google_meet',
              title: 'Meeting bots remain transcript-only for beta',
              meeting_chunk_provider_id: 'dev-seed-meeting-001',
              source_payload_ref: 'inline://timeline/dev-seed/meeting/meeting-bots-transcript',
              payload_digest: 'sha256:dev-seed-meeting-bots-transcript-payload',
            },
          },
          {
            id: IDS.eventGithub,
            teamId: IDS.team,
            authorUserId: IDS.owner,
            source: 'integration',
            contentText:
              'GitHub PR timborovkov/the-timeline-ai#42 updated: Add dev seed script and README instructions.',
            occurredAt: new Date('2026-06-18T08:40:00.000Z'),
            visibility: 'team',
            sourceMetadata: {
              seed: true,
              provider: 'github',
              event_type: 'pr.updated',
              external_object_id: 'timborovkov/the-timeline-ai#42',
              dedup_key: 'github:dev-seed:pr:42',
              github: {
                type: 'pull_request',
                repo: 'timborovkov/the-timeline-ai',
                number: 42,
              },
            },
          },
          {
            id: IDS.eventGithubReview,
            teamId: IDS.team,
            authorUserId: IDS.owner,
            source: 'integration',
            contentText:
              'GitHub PR timborovkov/the-timeline-ai#42 review (COMMENTED): The seed now demonstrates bundled timeline moments.',
            occurredAt: new Date('2026-06-18T08:39:00.000Z'),
            visibility: 'team',
            sourceMetadata: {
              seed: true,
              provider: 'github',
              event_type: 'pr.review.commented',
              external_object_id: 'timborovkov/the-timeline-ai#42',
              dedup_key: 'github:dev-seed:pr:42:review',
              github: {
                type: 'review',
                repo: 'timborovkov/the-timeline-ai',
                pr_number: 42,
                state: 'commented',
              },
            },
          },
          {
            id: IDS.eventGithubWorkflowSuccess,
            teamId: IDS.team,
            authorUserId: IDS.owner,
            source: 'integration',
            contentText: 'GitHub workflow "CI" #1042 on timborovkov/the-timeline-ai success',
            occurredAt: new Date('2026-06-18T08:37:00.000Z'),
            visibility: 'team',
            sourceMetadata: {
              seed: true,
              provider: 'github',
              event_type: 'workflow_run.success',
              external_object_id: 'timborovkov/the-timeline-ai:CI:main',
              dedup_key: 'github:dev-seed:workflow:1042',
              github: {
                type: 'workflow_run',
                repo: 'timborovkov/the-timeline-ai',
                workflow_name: 'CI',
                head_branch: 'main',
              },
            },
          },
          {
            id: IDS.eventGithubWorkflowRetry,
            teamId: IDS.team,
            authorUserId: IDS.owner,
            source: 'integration',
            contentText: 'GitHub workflow "CI" #1041 on timborovkov/the-timeline-ai success',
            occurredAt: new Date('2026-06-18T08:31:00.000Z'),
            visibility: 'team',
            sourceMetadata: {
              seed: true,
              provider: 'github',
              event_type: 'workflow_run.success',
              external_object_id: 'timborovkov/the-timeline-ai:CI:main',
              dedup_key: 'github:dev-seed:workflow:1041',
              github: {
                type: 'workflow_run',
                repo: 'timborovkov/the-timeline-ai',
                workflow_name: 'CI',
                head_branch: 'main',
              },
            },
          },
          {
            id: IDS.eventLinear,
            teamId: IDS.team,
            authorUserId: IDS.owner,
            source: 'integration',
            contentText:
              'Linear issue TL-101 moved to In Progress: Polish seeded object pages for demo data.',
            occurredAt: new Date('2026-06-18T08:45:00.000Z'),
            visibility: 'team',
            sourceMetadata: {
              seed: true,
              provider: 'linear',
              event_type: 'issue.updated',
              external_object_id: 'TL-101',
              dedup_key: 'linear:dev-seed:issue:TL-101',
            },
          },
          {
            id: DEMO_IDS.eventNote,
            teamId: DEMO_IDS.team,
            authorUserId: DEMO_IDS.owner,
            source: 'slack',
            contentText: DEMO_EVENTS[0].contentText,
            occurredAt: new Date(DEMO_TIMES.note),
            createdAt: new Date(DEMO_TIMES.note),
            visibility: 'team',
            sourceMetadata: {
              fixture_version: DEMO_FIXTURE_VERSION,
              capture_kind: 'explicit_chat_note',
              command: '/timeline note',
              slack_event_id: 'EvDEMOSEEDNORTHSTAR001',
              slack_channel_name: '#northstar-pilot',
              source_payload_ref: DEMO_SOURCE_REFS.note,
            },
          },
          {
            id: DEMO_IDS.eventEmail,
            teamId: DEMO_IDS.team,
            authorUserId: DEMO_IDS.member,
            source: 'email',
            contentText: DEMO_EVENTS[1].contentText,
            occurredAt: new Date(DEMO_TIMES.email),
            createdAt: new Date(DEMO_TIMES.email),
            visibility: 'team',
            sourceMetadata: {
              fixture_version: DEMO_FIXTURE_VERSION,
              message_id: 'demo-seed-northstar-export-commitment-001',
              from: 'elena.park@northstar.example',
              subject: 'Northstar pilot export commitment',
              attachment_name: 'Northstar pilot handoff brief.txt',
              source_payload_ref: DEMO_SOURCE_REFS.email,
            },
          },
          {
            id: DEMO_IDS.eventMeeting,
            teamId: DEMO_IDS.team,
            authorUserId: DEMO_IDS.owner,
            source: 'meeting',
            contentText: DEMO_EVENTS[2].contentText,
            occurredAt: new Date(DEMO_TIMES.meeting),
            createdAt: new Date(DEMO_TIMES.meeting),
            visibility: 'team',
            sourceMetadata: {
              fixture_version: DEMO_FIXTURE_VERSION,
              meeting_id: DEMO_IDS.meeting,
              platform: 'meet',
              title: 'Northstar pilot handoff review',
              meeting_chunk_provider_id: 'demo-seed-northstar-meeting-001',
              source_payload_ref: DEMO_SOURCE_REFS.meeting,
            },
          },
          {
            id: DEMO_IDS.eventProvider,
            teamId: DEMO_IDS.team,
            authorUserId: DEMO_IDS.member,
            source: 'integration',
            contentText: DEMO_EVENTS[3].contentText,
            occurredAt: new Date(DEMO_TIMES.provider),
            createdAt: new Date(DEMO_TIMES.provider),
            visibility: 'team',
            sourceMetadata: {
              fixture_version: DEMO_FIXTURE_VERSION,
              provider: 'linear',
              integration_id: DEMO_IDS.linearIntegration,
              selection_external_id: 'LIN-TL',
              event_type: 'issue.updated',
              external_object_id: 'NORTH-42',
              dedup_key: 'linear:demo-seed:issue:NORTH-42:blocked',
              source_payload_ref: DEMO_SOURCE_REFS.provider,
            },
          },
        ])
        .onConflictDoNothing();

      await tx
        .insert(documents)
        .values({
          id: DEMO_IDS.document,
          teamId: DEMO_IDS.team,
          fileKind: 'document',
          name: 'Northstar pilot handoff brief.txt',
          currentVersionId: null,
          ownerUserId: DEMO_IDS.member,
          visibility: 'team',
          metadata: {
            fixture_version: DEMO_FIXTURE_VERSION,
            source_surface: 'email_attachment',
          },
          sourceRawEventId: DEMO_IDS.eventEmail,
          promotedAt: new Date(DEMO_TIMES.email),
          promotedByUserId: DEMO_IDS.member,
          createdAt: new Date(DEMO_TIMES.email),
          updatedAt: new Date(DEMO_TIMES.email),
        })
        .onConflictDoUpdate({
          target: documents.id,
          set: {
            name: sql`excluded.name`,
            ownerUserId: sql`excluded.owner_user_id`,
            visibility: sql`excluded.visibility`,
            visibilityUserIds: null,
            metadata: sql`excluded.metadata`,
            sourceRawEventId: sql`excluded.source_raw_event_id`,
            promotedAt: sql`excluded.promoted_at`,
            promotedByUserId: sql`excluded.promoted_by_user_id`,
            deletedAt: null,
            updatedAt: sql`excluded.updated_at`,
          },
        });

      await tx
        .insert(documentVersions)
        .values({
          id: DEMO_IDS.documentVersion,
          teamId: DEMO_IDS.team,
          documentId: DEMO_IDS.document,
          version: 1,
          objectKey: DEMO_DOCUMENT_OBJECT_KEY,
          byteSize: DEMO_DOCUMENT_BYTE_SIZE,
          contentType: DEMO_DOCUMENT_CONTENT_TYPE,
          checksumSha256: DEMO_DOCUMENT_CHECKSUM_SHA256,
          uploadedByUserId: DEMO_IDS.member,
          sourceEventId: DEMO_IDS.eventEmail,
          processingStatus: 'chunked',
          extractionModelVersion: DEMO_FIXTURE_VERSION,
          embeddingModelVersion: null,
          createdAt: new Date(DEMO_TIMES.email),
        })
        .onConflictDoUpdate({
          target: documentVersions.id,
          set: {
            documentId: sql`excluded.document_id`,
            version: sql`excluded.version`,
            objectKey: sql`excluded.object_key`,
            byteSize: sql`excluded.byte_size`,
            contentType: sql`excluded.content_type`,
            checksumSha256: sql`excluded.checksum_sha256`,
            uploadedByUserId: sql`excluded.uploaded_by_user_id`,
            processingStatus: sql`excluded.processing_status`,
            processingError: null,
            extractionModelVersion: sql`excluded.extraction_model_version`,
            embeddingModelVersion: null,
          },
        });

      await tx
        .insert(documentChunks)
        .values({
          id: DEMO_IDS.documentChunk,
          teamId: DEMO_IDS.team,
          documentId: DEMO_IDS.document,
          documentVersionId: DEMO_IDS.documentVersion,
          chunkIndex: 0,
          representationKind: 'source_text',
          text: DEMO_DOCUMENT_TEXT,
          tokenCount: 25,
          summary: 'Northstar pilot handoff, decision, and unresolved export blocker.',
          createdAt: new Date(DEMO_TIMES.email),
        })
        .onConflictDoUpdate({
          target: documentChunks.id,
          set: {
            documentId: sql`excluded.document_id`,
            documentVersionId: sql`excluded.document_version_id`,
            chunkIndex: sql`excluded.chunk_index`,
            representationKind: sql`excluded.representation_kind`,
            text: sql`excluded.text`,
            tokenCount: sql`excluded.token_count`,
            summary: sql`excluded.summary`,
          },
        });

      await tx
        .update(documents)
        .set({ currentVersionId: DEMO_IDS.documentVersion })
        .where(and(eq(documents.teamId, DEMO_IDS.team), eq(documents.id, DEMO_IDS.document)));

      await tx
        .update(rawEvents)
        .set({
          sourceMetadata: sql`${rawEvents.sourceMetadata} - 'embedded_at' - 'embedding_model' - 'embedding_chunks' - 'embedding_failed_at' - 'embedding_error'`,
        })
        .where(
          and(
            eq(rawEvents.teamId, DEMO_IDS.team),
            inArray(
              rawEvents.id,
              DEMO_EVENTS.map((event) => event.id),
            ),
          ),
        );

      await tx
        .update(rawEvents)
        .set({
          sourceMetadata: sql`jsonb_set(coalesce(${rawEvents.sourceMetadata}, '{}'::jsonb), '{fixture_version}', to_jsonb(${DEMO_FIXTURE_VERSION}::text), true)`,
        })
        .where(
          and(
            eq(rawEvents.teamId, IDS.team),
            inArray(rawEvents.id, [
              IDS.eventKickoff,
              IDS.eventEmail,
              IDS.eventSlack,
              IDS.eventMeeting,
              IDS.eventGithub,
              IDS.eventGithubReview,
              IDS.eventGithubWorkflowSuccess,
              IDS.eventGithubWorkflowRetry,
              IDS.eventLinear,
            ]),
          ),
        );

      await tx
        .insert(meetings)
        .values({
          id: DEMO_IDS.meeting,
          teamId: DEMO_IDS.team,
          createdByUserId: DEMO_IDS.owner,
          provider: 'demo-fixture',
          platform: 'meet',
          meetingUrl: 'https://meet.example.test/northstar-pilot-review',
          title: 'Northstar pilot handoff review',
          status: 'completed',
          defaultVisibility: 'team',
          participants: [
            { name: 'Avery Timeline', role: 'owner' },
            { name: 'Mika Product', role: 'handoff_owner' },
          ],
          metadata: {
            fixture_version: DEMO_FIXTURE_VERSION,
            silent: true,
            consent_confirmed: true,
            source_payload_ref: DEMO_SOURCE_REFS.meeting,
          },
          startedAt: new Date(DEMO_TIMES.meeting),
          endedAt: new Date('2026-07-08T15:30:00.000Z'),
          createdAt: new Date(DEMO_TIMES.meeting),
          updatedAt: new Date(DEMO_TIMES.meeting),
        })
        .onConflictDoUpdate({
          target: meetings.id,
          set: {
            createdByUserId: sql`excluded.created_by_user_id`,
            provider: sql`excluded.provider`,
            providerBotId: null,
            platform: sql`excluded.platform`,
            meetingUrl: sql`excluded.meeting_url`,
            title: sql`excluded.title`,
            status: sql`excluded.status`,
            defaultVisibility: sql`excluded.default_visibility`,
            visibilityUserIds: null,
            participants: sql`excluded.participants`,
            metadata: sql`excluded.metadata`,
            startedAt: sql`excluded.started_at`,
            endedAt: sql`excluded.ended_at`,
            updatedAt: sql`excluded.updated_at`,
          },
        });

      await tx
        .insert(meetingTranscriptChunks)
        .values({
          id: DEMO_IDS.meetingChunk,
          meetingId: DEMO_IDS.meeting,
          teamId: DEMO_IDS.team,
          speaker: 'Avery and Mika',
          text: 'Avery: I am handing export validation to Mika. Mika: I own it. We will use the CSV fallback, but field-mapping confirmation is still blocking completion.',
          startMs: 12_000,
          endMs: 31_000,
          rawEventId: DEMO_IDS.eventMeeting,
          providerChunkId: 'demo-seed-northstar-chunk-001',
          createdAt: new Date(DEMO_TIMES.meeting),
        })
        .onConflictDoUpdate({
          target: meetingTranscriptChunks.id,
          set: {
            meetingId: sql`excluded.meeting_id`,
            speaker: sql`excluded.speaker`,
            text: sql`excluded.text`,
            startMs: sql`excluded.start_ms`,
            endMs: sql`excluded.end_ms`,
            rawEventId: sql`excluded.raw_event_id`,
            providerChunkId: sql`excluded.provider_chunk_id`,
          },
        });

      await tx
        .insert(entities)
        .values([
          {
            id: IDS.objectProject,
            teamId: IDS.team,
            type: 'project',
            canonicalName: 'Project Atlas',
            aliases: ['Atlas beta'],
            metadata: { seed: true, summary: 'Customer timeline unification beta.' },
            status: 'open',
            stage: 'beta_prep',
            priority: 1,
            ownerUserId: IDS.owner,
            sourceEventId: null,
          },
          {
            id: IDS.objectTask,
            teamId: IDS.team,
            type: 'task',
            canonicalName: 'Approve vendor security appendix',
            aliases: ['Vendor contract review'],
            metadata: { seed: true, source: 'email' },
            status: 'open',
            stage: 'in_progress',
            priority: 2,
            ownerUserId: IDS.member,
            assigneeUserId: IDS.member,
            dueAt: new Date('2026-06-19T17:00:00.000Z'),
            taskCategory: 'legal_compliance',
            taskCategoryMode: 'automatic',
            taskCategorySource: 'llm',
            taskCategoryStatus: 'ready',
            taskCategoryAppliedInputHash: 'dev-seed-task-category-v1',
            taskCategoryTaxonomyVersion: 'task-categories-v1',
            taskCategoryUpdatedAt: new Date('2026-06-18T09:00:00.000Z'),
            sourceEventId: null,
          },
          {
            id: IDS.objectDecision,
            teamId: IDS.team,
            type: 'decision',
            canonicalName: 'Meeting bots remain transcript-only for beta',
            aliases: ['Transcript-only meeting bots'],
            metadata: { seed: true, rationale: 'Consent-gated capture without voice agent mode.' },
            status: 'accepted',
            stage: 'decided',
            priority: 1,
            ownerUserId: IDS.owner,
            sourceEventId: null,
          },
          {
            id: IDS.objectCompany,
            teamId: IDS.team,
            type: 'company',
            canonicalName: 'Acme Labs',
            aliases: ['Acme'],
            metadata: { seed: true, domain: 'timeline.dev' },
            status: 'active',
            ownerUserId: IDS.owner,
          },
          {
            id: IDS.objectPerson,
            teamId: IDS.team,
            type: 'person',
            canonicalName: 'Mika Product',
            aliases: ['Mika'],
            metadata: { seed: true, email: 'member@timeline.dev', role: 'Product lead' },
            status: 'active',
            ownerUserId: IDS.member,
          },
          {
            id: DEMO_IDS.objectPilot,
            teamId: DEMO_IDS.team,
            type: DEMO_ENTITIES[0].type,
            canonicalName: DEMO_ENTITIES[0].canonicalName,
            aliases: ['Northstar Works pilot'],
            metadata: {
              fixture_version: DEMO_FIXTURE_VERSION,
              customer: 'Northstar Works',
              review_date: '2026-07-15',
            },
            status: DEMO_ENTITIES[0].status,
            stage: DEMO_ENTITIES[0].stage,
            priority: 1,
            ownerUserId: DEMO_ENTITIES[0].ownerUserId,
            sourceEventId: null,
          },
          {
            id: DEMO_IDS.objectDelivery,
            teamId: DEMO_IDS.team,
            type: DEMO_ENTITIES[1].type,
            canonicalName: DEMO_ENTITIES[1].canonicalName,
            aliases: ['NORTH-42', 'Northstar export validation'],
            metadata: {
              fixture_version: DEMO_FIXTURE_VERSION,
              blocker: 'Waiting for field-mapping confirmation',
              provider: 'linear',
              external_object_id: 'NORTH-42',
            },
            status: DEMO_ENTITIES[1].status,
            stage: DEMO_ENTITIES[1].stage,
            priority: 1,
            ownerUserId: DEMO_ENTITIES[1].ownerUserId,
            assigneeUserId: DEMO_ENTITIES[1].assigneeUserId,
            dueAt: new Date('2026-07-12T17:00:00.000Z'),
            taskCategory: 'engineering',
            taskCategoryMode: 'automatic',
            taskCategorySource: 'llm',
            taskCategoryStatus: 'ready',
            taskCategoryAppliedInputHash: 'demo-seed-northstar-task-v1',
            taskCategoryTaxonomyVersion: 'task-categories-v1',
            taskCategoryUpdatedAt: new Date(DEMO_TIMES.provider),
            sourceEventId: null,
          },
          {
            id: DEMO_IDS.objectDecision,
            teamId: DEMO_IDS.team,
            type: DEMO_ENTITIES[2].type,
            canonicalName: DEMO_ENTITIES[2].canonicalName,
            aliases: ['Northstar CSV fallback'],
            metadata: {
              fixture_version: DEMO_FIXTURE_VERSION,
              rationale: 'Keeps the pilot moving while field mapping is clarified.',
            },
            status: DEMO_ENTITIES[2].status,
            stage: DEMO_ENTITIES[2].stage,
            priority: 1,
            ownerUserId: DEMO_ENTITIES[2].ownerUserId,
            sourceEventId: null,
          },
        ])
        .onConflictDoUpdate({
          target: entities.id,
          set: {
            canonicalName: sql`excluded.canonical_name`,
            aliases: sql`excluded.aliases`,
            metadata: sql`excluded.metadata`,
            status: sql`excluded.status`,
            stage: sql`excluded.stage`,
            priority: sql`excluded.priority`,
            ownerUserId: sql`excluded.owner_user_id`,
            assigneeUserId: sql`excluded.assignee_user_id`,
            dueAt: sql`excluded.due_at`,
            taskCategory: sql`excluded.task_category`,
            taskCategoryMode: sql`excluded.task_category_mode`,
            taskCategorySource: sql`excluded.task_category_source`,
            taskCategoryStatus: sql`excluded.task_category_status`,
            taskCategoryAppliedInputHash: sql`excluded.task_category_applied_input_hash`,
            taskCategoryRequestedInputHash: sql`excluded.task_category_requested_input_hash`,
            taskCategoryTaxonomyVersion: sql`excluded.task_category_taxonomy_version`,
            taskCategoryUpdatedAt: sql`excluded.task_category_updated_at`,
            sourceEventId: null,
            updatedAt: now,
          },
        });

      await tx
        .insert(facts)
        .values([
          {
            id: IDS.factKickoff,
            teamId: IDS.team,
            rawEventId: IDS.eventKickoff,
            statement: 'Project Atlas aims to unify customer timelines before the July beta.',
            confidence: 0.96,
            modelVersion: DEMO_FIXTURE_VERSION,
            extractedAt: now,
          },
          {
            id: IDS.factEmail,
            teamId: IDS.team,
            rawEventId: IDS.eventEmail,
            statement: 'The vendor security appendix needs approval by Friday.',
            confidence: 0.92,
            modelVersion: DEMO_FIXTURE_VERSION,
            extractedAt: now,
          },
          {
            id: IDS.factMeeting,
            teamId: IDS.team,
            rawEventId: IDS.eventMeeting,
            statement: 'Meeting bots should remain transcript-only and consent-gated for beta.',
            confidence: 0.95,
            modelVersion: DEMO_FIXTURE_VERSION,
            extractedAt: now,
          },
          {
            id: DEMO_IDS.factCommitment,
            teamId: DEMO_IDS.team,
            rawEventId: DEMO_IDS.eventEmail,
            statement: DEMO_FACTS.commitment,
            confidence: 0.99,
            modelVersion: DEMO_FIXTURE_VERSION,
            extractedAt: new Date(DEMO_TIMES.email),
          },
          {
            id: DEMO_IDS.factHandoff,
            teamId: DEMO_IDS.team,
            rawEventId: DEMO_IDS.eventMeeting,
            statement: DEMO_FACTS.handoff,
            confidence: 0.99,
            modelVersion: DEMO_FIXTURE_VERSION,
            extractedAt: new Date(DEMO_TIMES.meeting),
          },
          {
            id: DEMO_IDS.factDecision,
            teamId: DEMO_IDS.team,
            rawEventId: DEMO_IDS.eventMeeting,
            statement: DEMO_FACTS.decision,
            confidence: 0.99,
            modelVersion: DEMO_FIXTURE_VERSION,
            extractedAt: new Date(DEMO_TIMES.meeting),
          },
          {
            id: DEMO_IDS.factBlocker,
            teamId: DEMO_IDS.team,
            rawEventId: DEMO_IDS.eventProvider,
            statement: DEMO_FACTS.blocker,
            confidence: 0.99,
            modelVersion: DEMO_FIXTURE_VERSION,
            extractedAt: new Date(DEMO_TIMES.provider),
          },
          {
            id: DEMO_IDS.factStatus,
            teamId: DEMO_IDS.team,
            rawEventId: DEMO_IDS.eventProvider,
            statement: DEMO_FACTS.status,
            confidence: 0.99,
            modelVersion: DEMO_FIXTURE_VERSION,
            extractedAt: new Date(DEMO_TIMES.provider),
          },
        ])
        .onConflictDoUpdate({
          target: facts.id,
          set: {
            statement: sql`excluded.statement`,
            rawEventId: sql`excluded.raw_event_id`,
          },
        });

      await tx
        .insert(factEntities)
        .values([
          { factId: IDS.factKickoff, entityId: IDS.objectProject, role: 'subject' },
          { factId: IDS.factEmail, entityId: IDS.objectTask, role: 'subject' },
          { factId: IDS.factMeeting, entityId: IDS.objectDecision, role: 'subject' },
          {
            factId: DEMO_IDS.factCommitment,
            entityId: DEMO_IDS.objectPilot,
            role: 'subject',
          },
          {
            factId: DEMO_IDS.factHandoff,
            entityId: DEMO_IDS.objectDelivery,
            role: 'subject',
          },
          {
            factId: DEMO_IDS.factDecision,
            entityId: DEMO_IDS.objectDecision,
            role: 'subject',
          },
          {
            factId: DEMO_IDS.factBlocker,
            entityId: DEMO_IDS.objectDelivery,
            role: 'subject',
          },
          {
            factId: DEMO_IDS.factStatus,
            entityId: DEMO_IDS.objectDelivery,
            role: 'subject',
          },
        ])
        .onConflictDoNothing();

      await tx
        .insert(artifactClusters)
        .values([
          {
            id: IDS.clusterProject,
            teamId: IDS.team,
            artifactClusterKind: 'customer_project',
            artifactType: 'project',
            canonicalName: 'Project Atlas',
            status: 'active',
            canonicalEntityId: IDS.objectProject,
            metadata: { seed: true },
          },
          {
            id: IDS.clusterTask,
            teamId: IDS.team,
            artifactClusterKind: 'task',
            artifactType: 'task',
            canonicalName: 'Approve vendor security appendix',
            status: 'active',
            canonicalEntityId: IDS.objectTask,
            metadata: { seed: true },
          },
          {
            id: IDS.clusterDecision,
            teamId: IDS.team,
            artifactClusterKind: 'decision',
            artifactType: 'decision',
            canonicalName: 'Meeting bots remain transcript-only for beta',
            status: 'resolved',
            canonicalEntityId: IDS.objectDecision,
            metadata: { seed: true },
          },
          {
            id: DEMO_IDS.clusterPilot,
            teamId: DEMO_IDS.team,
            artifactClusterKind: 'customer_project',
            artifactType: 'project',
            canonicalName: 'Northstar pilot',
            status: 'active',
            canonicalEntityId: DEMO_IDS.objectPilot,
            metadata: { fixture_version: DEMO_FIXTURE_VERSION },
          },
          {
            id: DEMO_IDS.clusterDelivery,
            teamId: DEMO_IDS.team,
            artifactClusterKind: 'task',
            artifactType: 'task',
            canonicalName: 'Validate Northstar pilot export',
            status: 'active',
            canonicalEntityId: DEMO_IDS.objectDelivery,
            metadata: {
              fixture_version: DEMO_FIXTURE_VERSION,
              provider: 'linear',
              external_object_id: 'NORTH-42',
            },
          },
          {
            id: DEMO_IDS.clusterDecision,
            teamId: DEMO_IDS.team,
            artifactClusterKind: 'decision',
            artifactType: 'decision',
            canonicalName: 'Use CSV fallback for Northstar pilot',
            status: 'resolved',
            canonicalEntityId: DEMO_IDS.objectDecision,
            metadata: { fixture_version: DEMO_FIXTURE_VERSION },
          },
        ])
        .onConflictDoUpdate({
          target: artifactClusters.id,
          set: {
            artifactClusterKind: sql`excluded.artifact_cluster_kind`,
            artifactType: sql`excluded.artifact_type`,
            canonicalName: sql`excluded.canonical_name`,
            status: sql`excluded.status`,
            canonicalEntityId: sql`excluded.canonical_entity_id`,
            metadata: sql`excluded.metadata`,
            updatedAt: now,
          },
        });

      await tx
        .insert(reconciliationEvidence)
        .values([
          {
            id: IDS.evidenceKickoff,
            teamId: IDS.team,
            rawEventId: IDS.eventKickoff,
            sourcePayloadRef: 'inline://timeline/dev-seed/manual-note/project-atlas-kickoff',
            payloadDigest: 'sha256:dev-seed-kickoff-note-payload',
            source: 'web',
            eventType: 'manual_note.created',
            occurredAt: new Date('2026-06-17T09:00:00.000Z'),
            visibility: 'team',
            visibilityOwnerUserId: null,
            visibilityUserIds: null,
            actor: { user_id: IDS.owner },
            contentDigest: 'sha256:dev-seed-kickoff-note',
            title: 'Project Atlas kickoff note',
            summary: 'Acme Labs is launching Project Atlas before the July beta.',
            metadata: { seed: true, target_entity_id: IDS.objectProject },
            normalizerVersion: 'dev-seed-reconciliation-2026-07',
            replayState: 'full',
            dedupeKey: 'dev-seed:evidence:project-atlas-kickoff',
          },
          {
            id: IDS.evidenceEmail,
            teamId: IDS.team,
            rawEventId: IDS.eventEmail,
            sourcePayloadRef: 'inline://timeline/dev-seed/email/vendor-security-contract',
            payloadDigest: 'sha256:dev-seed-vendor-security-email-payload',
            source: 'email',
            externalEventId: 'dev-seed-email-contract-001',
            eventType: 'email.received',
            occurredAt: new Date('2026-06-17T11:15:00.000Z'),
            visibility: 'team',
            visibilityOwnerUserId: null,
            visibilityUserIds: null,
            actor: { email: 'member@timeline.dev' },
            contentDigest: 'sha256:dev-seed-vendor-security-email',
            title: 'Vendor contract review email',
            summary: 'The vendor security appendix needs approval by Friday.',
            metadata: { seed: true, target_entity_id: IDS.objectTask },
            normalizerVersion: 'dev-seed-reconciliation-2026-07',
            replayState: 'full',
            dedupeKey: 'dev-seed:evidence:vendor-security-email',
          },
          {
            id: IDS.evidenceMeeting,
            teamId: IDS.team,
            rawEventId: IDS.eventMeeting,
            sourcePayloadRef: 'inline://timeline/dev-seed/meeting/meeting-bots-transcript',
            payloadDigest: 'sha256:dev-seed-meeting-bots-transcript-payload',
            source: 'meeting',
            externalEventId: 'dev-seed-meeting-001',
            eventType: 'meeting.transcript_summary',
            occurredAt: new Date('2026-06-18T07:30:00.000Z'),
            visibility: 'team',
            visibilityOwnerUserId: null,
            visibilityUserIds: null,
            actor: { user_id: IDS.owner },
            contentDigest: 'sha256:dev-seed-meeting-bots-transcript',
            title: 'Meeting bots transcript-only decision',
            summary: 'Meeting bots stay transcript-only and consent-gated for beta.',
            metadata: { seed: true, target_entity_id: IDS.objectDecision },
            normalizerVersion: 'dev-seed-reconciliation-2026-07',
            replayState: 'full',
            dedupeKey: 'dev-seed:evidence:meeting-bots-decision',
          },
          {
            id: DEMO_IDS.evidenceNote,
            teamId: DEMO_IDS.team,
            rawEventId: DEMO_IDS.eventNote,
            sourcePayloadRef: DEMO_SOURCE_REFS.note,
            payloadDigest: 'sha256:demo-seed-northstar-note-payload',
            source: 'slack',
            externalEventId: 'EvDEMOSEEDNORTHSTAR001',
            eventType: 'explicit_note.created',
            occurredAt: new Date(DEMO_TIMES.note),
            visibility: 'team',
            visibilityOwnerUserId: null,
            visibilityUserIds: null,
            actor: { user_id: DEMO_IDS.owner },
            contentDigest: 'sha256:demo-seed-northstar-note',
            title: 'Northstar pilot kickoff note',
            summary: 'The pilot review is July 15 and the export path should stay narrow.',
            metadata: { fixture_version: DEMO_FIXTURE_VERSION },
            normalizerVersion: DEMO_FIXTURE_VERSION,
            replayState: 'full',
            dedupeKey: 'demo-seed:evidence:northstar-note',
          },
          {
            id: DEMO_IDS.evidenceEmail,
            teamId: DEMO_IDS.team,
            rawEventId: DEMO_IDS.eventEmail,
            sourcePayloadRef: DEMO_SOURCE_REFS.email,
            payloadDigest: 'sha256:demo-seed-northstar-email-payload',
            source: 'email',
            externalEventId: 'demo-seed-northstar-export-commitment-001',
            eventType: 'email.received',
            occurredAt: new Date(DEMO_TIMES.email),
            visibility: 'team',
            visibilityOwnerUserId: null,
            visibilityUserIds: null,
            actor: { email: 'elena.park@northstar.example' },
            contentDigest: 'sha256:demo-seed-northstar-email',
            title: 'Northstar export commitment',
            summary: DEMO_FACTS.commitment,
            metadata: {
              fixture_version: DEMO_FIXTURE_VERSION,
              document_id: DEMO_IDS.document,
            },
            normalizerVersion: DEMO_FIXTURE_VERSION,
            replayState: 'full',
            dedupeKey: 'demo-seed:evidence:northstar-email',
          },
          {
            id: DEMO_IDS.evidenceMeeting,
            teamId: DEMO_IDS.team,
            rawEventId: DEMO_IDS.eventMeeting,
            sourcePayloadRef: DEMO_SOURCE_REFS.meeting,
            payloadDigest: 'sha256:demo-seed-northstar-meeting-payload',
            source: 'meeting',
            externalEventId: 'demo-seed-northstar-meeting-001',
            eventType: 'meeting.transcript_summary',
            occurredAt: new Date(DEMO_TIMES.meeting),
            visibility: 'team',
            visibilityOwnerUserId: null,
            visibilityUserIds: null,
            actor: { user_id: DEMO_IDS.owner },
            contentDigest: 'sha256:demo-seed-northstar-meeting',
            title: 'Northstar pilot handoff review',
            summary: `${DEMO_FACTS.handoff} ${DEMO_FACTS.decision}`,
            metadata: {
              fixture_version: DEMO_FIXTURE_VERSION,
              meeting_id: DEMO_IDS.meeting,
            },
            normalizerVersion: DEMO_FIXTURE_VERSION,
            replayState: 'full',
            dedupeKey: 'demo-seed:evidence:northstar-meeting',
          },
          {
            id: DEMO_IDS.evidenceProvider,
            teamId: DEMO_IDS.team,
            rawEventId: DEMO_IDS.eventProvider,
            sourcePayloadRef: DEMO_SOURCE_REFS.provider,
            payloadDigest: 'sha256:demo-seed-northstar-linear-payload',
            source: 'integration',
            provider: 'linear',
            externalObjectId: 'NORTH-42',
            externalEventId: 'NORTH-42:blocked',
            eventType: 'issue.updated',
            occurredAt: new Date(DEMO_TIMES.provider),
            visibility: 'team',
            visibilityOwnerUserId: null,
            visibilityUserIds: null,
            actor: { user_id: DEMO_IDS.member },
            contentDigest: 'sha256:demo-seed-northstar-linear',
            title: 'NORTH-42 blocked',
            summary: `${DEMO_FACTS.status} ${DEMO_FACTS.blocker}`,
            metadata: {
              fixture_version: DEMO_FIXTURE_VERSION,
              integration_id: DEMO_IDS.linearIntegration,
              selection_external_id: 'LIN-TL',
            },
            normalizerVersion: DEMO_FIXTURE_VERSION,
            replayState: 'full',
            dedupeKey: 'demo-seed:evidence:northstar-linear-blocked',
          },
        ])
        .onConflictDoUpdate({
          target: reconciliationEvidence.id,
          set: {
            rawEventId: sql`excluded.raw_event_id`,
            sourcePayloadRef: sql`excluded.source_payload_ref`,
            payloadDigest: sql`excluded.payload_digest`,
            source: sql`excluded.source`,
            provider: sql`excluded.provider`,
            externalObjectId: sql`excluded.external_object_id`,
            externalEventId: sql`excluded.external_event_id`,
            eventType: sql`excluded.event_type`,
            occurredAt: sql`excluded.occurred_at`,
            visibility: sql`excluded.visibility`,
            visibilityOwnerUserId: sql`excluded.visibility_owner_user_id`,
            visibilityUserIds: sql`excluded.visibility_user_ids`,
            actor: sql`excluded.actor`,
            contentDigest: sql`excluded.content_digest`,
            title: sql`excluded.title`,
            summary: sql`excluded.summary`,
            metadata: sql`excluded.metadata`,
            normalizerVersion: sql`excluded.normalizer_version`,
            replayState: sql`excluded.replay_state`,
            dedupeKey: sql`excluded.dedupe_key`,
          },
        });

      await tx
        .insert(artifactEvidenceAssociations)
        .values([
          {
            id: IDS.associationKickoff,
            teamId: IDS.team,
            clusterId: IDS.clusterProject,
            evidenceId: IDS.evidenceKickoff,
            rawEventId: IDS.eventKickoff,
            role: 'origin',
            strength: 'human',
            associationSource: 'human',
            rationale: 'Seed kickoff note explicitly creates Project Atlas.',
            sourceRefs: [
              { source: 'web', rawEventId: IDS.eventKickoff, evidenceId: IDS.evidenceKickoff },
            ],
            visibility: 'team',
            visibilityOwnerUserId: null,
            visibilityUserIds: null,
            visibilityFloor: 'team',
            visibilityFloorOwnerUserId: null,
            visibilityFloorUserIds: null,
            metadata: { seed: true },
            dedupeKey: 'dev-seed:association:project-atlas-kickoff',
          },
          {
            id: IDS.associationEmail,
            teamId: IDS.team,
            clusterId: IDS.clusterTask,
            evidenceId: IDS.evidenceEmail,
            rawEventId: IDS.eventEmail,
            role: 'update',
            strength: 'structured',
            associationSource: 'structured_anchor',
            rationale: 'Seed email explicitly describes the vendor security task.',
            sourceRefs: [
              { source: 'email', rawEventId: IDS.eventEmail, evidenceId: IDS.evidenceEmail },
            ],
            visibility: 'team',
            visibilityOwnerUserId: null,
            visibilityUserIds: null,
            visibilityFloor: 'team',
            visibilityFloorOwnerUserId: null,
            visibilityFloorUserIds: null,
            metadata: { seed: true },
            dedupeKey: 'dev-seed:association:vendor-security-email',
          },
          {
            id: IDS.associationMeeting,
            teamId: IDS.team,
            clusterId: IDS.clusterDecision,
            evidenceId: IDS.evidenceMeeting,
            rawEventId: IDS.eventMeeting,
            role: 'decision',
            strength: 'human',
            associationSource: 'human',
            rationale: 'Seed meeting transcript explicitly records the beta bot decision.',
            sourceRefs: [
              {
                source: 'meeting',
                rawEventId: IDS.eventMeeting,
                evidenceId: IDS.evidenceMeeting,
              },
            ],
            visibility: 'team',
            visibilityOwnerUserId: null,
            visibilityUserIds: null,
            visibilityFloor: 'team',
            visibilityFloorOwnerUserId: null,
            visibilityFloorUserIds: null,
            metadata: { seed: true },
            dedupeKey: 'dev-seed:association:meeting-bots-decision',
          },
          demoAssociation({
            id: DEMO_IDS.associationNote,
            clusterId: DEMO_IDS.clusterPilot,
            evidenceId: DEMO_IDS.evidenceNote,
            rawEventId: DEMO_IDS.eventNote,
            source: 'slack',
            role: 'discussion',
            strength: 'human',
            associationSource: 'human',
            rationale: 'The explicit team note establishes the private demo scenario context.',
            dedupeKey: 'demo-seed:association:northstar-note',
          }),
          demoAssociation({
            id: DEMO_IDS.associationCommitment,
            clusterId: DEMO_IDS.clusterPilot,
            evidenceId: DEMO_IDS.evidenceEmail,
            rawEventId: DEMO_IDS.eventEmail,
            source: 'email',
            role: 'update',
            strength: 'structured',
            associationSource: 'structured_anchor',
            rationale: 'The customer email explicitly commits to the final sample export date.',
            dedupeKey: 'demo-seed:association:northstar-customer-commitment',
          }),
          demoAssociation({
            id: DEMO_IDS.associationHandoff,
            clusterId: DEMO_IDS.clusterDelivery,
            evidenceId: DEMO_IDS.evidenceMeeting,
            rawEventId: DEMO_IDS.eventMeeting,
            source: 'meeting',
            role: 'update',
            strength: 'human',
            associationSource: 'human',
            rationale: 'The meeting transcript explicitly records Avery handing ownership to Mika.',
            dedupeKey: 'demo-seed:association:northstar-handoff',
          }),
          demoAssociation({
            id: DEMO_IDS.associationDecision,
            clusterId: DEMO_IDS.clusterDecision,
            evidenceId: DEMO_IDS.evidenceMeeting,
            rawEventId: DEMO_IDS.eventMeeting,
            source: 'meeting',
            role: 'decision',
            strength: 'human',
            associationSource: 'human',
            rationale: 'The meeting transcript explicitly records the CSV fallback decision.',
            dedupeKey: 'demo-seed:association:northstar-decision',
          }),
          demoAssociation({
            id: DEMO_IDS.associationBlocker,
            clusterId: DEMO_IDS.clusterDelivery,
            evidenceId: DEMO_IDS.evidenceProvider,
            rawEventId: DEMO_IDS.eventProvider,
            source: 'integration',
            role: 'blocker',
            strength: 'provider',
            associationSource: 'authoritative_provider',
            rationale:
              'Selected Linear issue NORTH-42 reports the unresolved field-mapping blocker.',
            dedupeKey: 'demo-seed:association:northstar-blocker',
          }),
          demoAssociation({
            id: DEMO_IDS.associationStatus,
            clusterId: DEMO_IDS.clusterDelivery,
            evidenceId: DEMO_IDS.evidenceProvider,
            rawEventId: DEMO_IDS.eventProvider,
            source: 'integration',
            role: 'lifecycle_update',
            strength: 'provider',
            associationSource: 'authoritative_provider',
            rationale:
              'Selected Linear issue NORTH-42 is authoritative for the current blocked state.',
            dedupeKey: 'demo-seed:association:northstar-current-status',
          }),
        ])
        .onConflictDoUpdate({
          target: artifactEvidenceAssociations.id,
          set: {
            clusterId: sql`excluded.cluster_id`,
            evidenceId: sql`excluded.evidence_id`,
            rawEventId: sql`excluded.raw_event_id`,
            role: sql`excluded.role`,
            strength: sql`excluded.strength`,
            associationSource: sql`excluded.association_source`,
            rationale: sql`excluded.rationale`,
            sourceRefs: sql`excluded.source_refs`,
            visibility: sql`excluded.visibility`,
            visibilityOwnerUserId: sql`excluded.visibility_owner_user_id`,
            visibilityUserIds: sql`excluded.visibility_user_ids`,
            visibilityFloor: sql`excluded.visibility_floor`,
            visibilityFloorOwnerUserId: sql`excluded.visibility_floor_owner_user_id`,
            visibilityFloorUserIds: sql`excluded.visibility_floor_user_ids`,
            metadata: sql`excluded.metadata`,
            dedupeKey: sql`excluded.dedupe_key`,
          },
        });

      await tx
        .insert(reconciliationRuns)
        .values({
          id: IDS.reconciliationRun,
          teamId: IDS.team,
          trigger: 'raw_event',
          scope: 'dev-seed',
          status: 'completed',
          inputFingerprint: 'dev-seed:reconciliation:objects:v1',
          engineVersion: 'dev-seed-reconciliation-2026-07',
          modelVersions: {},
          startedAt: now,
          completedAt: now,
          metrics: { seed: true, outputs: 3 },
        })
        .onConflictDoUpdate({
          target: reconciliationRuns.id,
          set: {
            status: sql`excluded.status`,
            inputFingerprint: sql`excluded.input_fingerprint`,
            engineVersion: sql`excluded.engine_version`,
            modelVersions: sql`excluded.model_versions`,
            startedAt: sql`excluded.started_at`,
            completedAt: sql`excluded.completed_at`,
            metrics: sql`excluded.metrics`,
          },
        });

      await tx
        .insert(reconciliationOutputs)
        .values([
          {
            id: IDS.outputProject,
            teamId: IDS.team,
            runId: IDS.reconciliationRun,
            clusterId: IDS.clusterProject,
            outputKind: 'direct_write',
            targetKind: 'object',
            operation: 'create',
            targetId: IDS.objectProject,
            payload: { seed: true, canonicalName: 'Project Atlas', type: 'project' },
            authorityDecision: {
              decision: 'direct_write',
              authority_decision: 'direct',
              policy_version: 'dev-seed-reconciliation-2026-07',
              reason: 'Seeded demo object created from seeded raw event.',
            },
            requiresApproval: false,
            sourceRefs: [
              {
                source: 'web',
                rawEventId: IDS.eventKickoff,
                sourcePayloadRef: 'inline://timeline/dev-seed/manual-note/project-atlas-kickoff',
              },
            ],
            sourcePayloadRefs: ['inline://timeline/dev-seed/manual-note/project-atlas-kickoff'],
            visibility: 'team',
            visibilityOwnerUserId: null,
            visibilityUserIds: null,
            visibilityFloor: 'team',
            visibilityFloorOwnerUserId: null,
            visibilityFloorUserIds: null,
            dedupeKey: 'dev-seed:output:project-atlas-create',
            status: 'applied',
          },
          {
            id: IDS.outputTask,
            teamId: IDS.team,
            runId: IDS.reconciliationRun,
            clusterId: IDS.clusterTask,
            outputKind: 'direct_write',
            targetKind: 'task',
            operation: 'create',
            targetId: IDS.objectTask,
            payload: {
              seed: true,
              canonicalName: 'Approve vendor security appendix',
              type: 'task',
            },
            authorityDecision: {
              decision: 'direct_write',
              authority_decision: 'direct',
              policy_version: 'dev-seed-reconciliation-2026-07',
              reason: 'Seeded demo task created from seeded raw event.',
            },
            requiresApproval: false,
            sourceRefs: [
              {
                source: 'email',
                rawEventId: IDS.eventEmail,
                sourcePayloadRef: 'inline://timeline/dev-seed/email/vendor-security-contract',
              },
            ],
            sourcePayloadRefs: ['inline://timeline/dev-seed/email/vendor-security-contract'],
            visibility: 'team',
            visibilityOwnerUserId: null,
            visibilityUserIds: null,
            visibilityFloor: 'team',
            visibilityFloorOwnerUserId: null,
            visibilityFloorUserIds: null,
            dedupeKey: 'dev-seed:output:vendor-security-task-create',
            status: 'applied',
          },
          {
            id: IDS.outputDecision,
            teamId: IDS.team,
            runId: IDS.reconciliationRun,
            clusterId: IDS.clusterDecision,
            outputKind: 'direct_write',
            targetKind: 'object',
            operation: 'create',
            targetId: IDS.objectDecision,
            payload: {
              seed: true,
              canonicalName: 'Meeting bots remain transcript-only for beta',
              type: 'decision',
            },
            authorityDecision: {
              decision: 'direct_write',
              authority_decision: 'direct',
              policy_version: 'dev-seed-reconciliation-2026-07',
              reason: 'Seeded demo decision created from seeded raw event.',
            },
            requiresApproval: false,
            sourceRefs: [
              {
                source: 'meeting',
                rawEventId: IDS.eventMeeting,
                sourcePayloadRef: 'inline://timeline/dev-seed/meeting/meeting-bots-transcript',
              },
            ],
            sourcePayloadRefs: ['inline://timeline/dev-seed/meeting/meeting-bots-transcript'],
            visibility: 'team',
            visibilityOwnerUserId: null,
            visibilityUserIds: null,
            visibilityFloor: 'team',
            visibilityFloorOwnerUserId: null,
            visibilityFloorUserIds: null,
            dedupeKey: 'dev-seed:output:meeting-bots-decision-create',
            status: 'applied',
          },
        ])
        .onConflictDoUpdate({
          target: reconciliationOutputs.id,
          set: {
            runId: sql`excluded.run_id`,
            clusterId: sql`excluded.cluster_id`,
            outputKind: sql`excluded.output_kind`,
            targetKind: sql`excluded.target_kind`,
            operation: sql`excluded.operation`,
            targetId: sql`excluded.target_id`,
            payload: sql`excluded.payload`,
            authorityDecision: sql`excluded.authority_decision`,
            requiresApproval: sql`excluded.requires_approval`,
            sourceRefs: sql`excluded.source_refs`,
            sourcePayloadRefs: sql`excluded.source_payload_refs`,
            visibility: sql`excluded.visibility`,
            visibilityOwnerUserId: sql`excluded.visibility_owner_user_id`,
            visibilityUserIds: sql`excluded.visibility_user_ids`,
            visibilityFloor: sql`excluded.visibility_floor`,
            visibilityFloorOwnerUserId: sql`excluded.visibility_floor_owner_user_id`,
            visibilityFloorUserIds: sql`excluded.visibility_floor_user_ids`,
            dedupeKey: sql`excluded.dedupe_key`,
            status: sql`excluded.status`,
            updatedAt: now,
          },
        });

      await tx
        .delete(entityRelationships)
        .where(
          and(
            eq(entityRelationships.teamId, IDS.team),
            ne(entityRelationships.id, IDS.relationshipProjectTask),
            eq(entityRelationships.fromEntityId, IDS.objectTask),
            eq(entityRelationships.toEntityId, IDS.objectProject),
            eq(entityRelationships.kind, 'child'),
          ),
        );

      await tx
        .insert(entityRelationships)
        .values([
          {
            id: IDS.relationshipProjectTask,
            teamId: IDS.team,
            fromEntityId: IDS.objectTask,
            toEntityId: IDS.objectProject,
            kind: 'child',
            createdBy: IDS.owner,
          },
          {
            id: IDS.relationshipProjectDecision,
            teamId: IDS.team,
            fromEntityId: IDS.objectProject,
            toEntityId: IDS.objectDecision,
            kind: 'related',
            createdBy: IDS.owner,
          },
        ])
        .onConflictDoUpdate({
          target: entityRelationships.id,
          set: {
            fromEntityId: sql`excluded.from_entity_id`,
            toEntityId: sql`excluded.to_entity_id`,
            kind: sql`excluded.kind`,
            createdBy: sql`excluded.created_by`,
          },
        });

      await tx
        .insert(taskCategoryAssignments)
        .values({
          id: IDS.taskCategoryAssignment,
          teamId: IDS.team,
          entityId: IDS.objectTask,
          category: 'legal_compliance',
          source: 'llm',
          mode: 'automatic',
          confidence: 0.94,
          model: 'dev-seed',
          promptVersion: 'task-category-prompt-v2',
          taxonomyVersion: 'task-categories-v1',
          inputHash: 'dev-seed-task-category-v1',
          outcome: 'applied',
          latencyMs: 12,
        })
        .onConflictDoUpdate({
          target: taskCategoryAssignments.id,
          set: {
            teamId: sql`excluded.team_id`,
            entityId: sql`excluded.entity_id`,
            category: sql`excluded.category`,
            source: sql`excluded.source`,
            mode: sql`excluded.mode`,
            confidence: sql`excluded.confidence`,
            model: sql`excluded.model`,
            promptVersion: sql`excluded.prompt_version`,
            taxonomyVersion: sql`excluded.taxonomy_version`,
            inputHash: sql`excluded.input_hash`,
            outcome: sql`excluded.outcome`,
            latencyMs: sql`excluded.latency_ms`,
          },
        });

      await tx
        .insert(boards)
        .values({
          id: IDS.board,
          teamId: IDS.team,
          createdBy: IDS.owner,
          name: 'Atlas Launch',
          purpose: 'Track seeded Project Atlas tasks and decisions.',
          templateKind: 'task_board',
          recommendedObjectTypes: ['task', 'decision', 'project'],
          strictObjectTypes: false,
          candidateFilter: { seed: true },
          isShared: true,
        })
        .onConflictDoUpdate({
          target: boards.id,
          set: {
            name: sql`excluded.name`,
            purpose: sql`excluded.purpose`,
            templateKind: sql`excluded.template_kind`,
            recommendedObjectTypes: sql`excluded.recommended_object_types`,
            candidateFilter: sql`excluded.candidate_filter`,
            updatedAt: now,
          },
        });

      await tx
        .insert(boardLanes)
        .values([
          {
            id: IDS.laneTodo,
            teamId: IDS.team,
            boardId: IDS.board,
            name: 'Todo',
            position: 0,
            kind: 'active',
          },
          {
            id: IDS.laneDoing,
            teamId: IDS.team,
            boardId: IDS.board,
            name: 'Doing',
            position: 1,
            kind: 'active',
          },
          {
            id: IDS.laneDone,
            teamId: IDS.team,
            boardId: IDS.board,
            name: 'Done',
            position: 2,
            kind: 'done',
          },
        ])
        .onConflictDoUpdate({
          target: boardLanes.id,
          set: {
            name: sql`excluded.name`,
            position: sql`excluded.position`,
            kind: sql`excluded.kind`,
            updatedAt: now,
          },
        });

      await tx
        .insert(boardItems)
        .values([
          {
            id: IDS.boardItemTask,
            teamId: IDS.team,
            boardId: IDS.board,
            entityId: IDS.objectTask,
            laneId: IDS.laneDoing,
            position: 0,
            responsibleUserId: IDS.member,
            dueAt: new Date('2026-06-19T17:00:00.000Z'),
            priority: 2,
            nextStep: 'Send security appendix to legal for final read.',
            notes: 'Seeded demo task from the inbound email event.',
          },
          {
            id: IDS.boardItemDecision,
            teamId: IDS.team,
            boardId: IDS.board,
            entityId: IDS.objectDecision,
            laneId: IDS.laneDone,
            position: 0,
            responsibleUserId: IDS.owner,
            priority: 1,
            nextStep: 'Keep meeting bot docs aligned with consent-gated transcript capture.',
            notes: 'Seeded decision from a meeting transcript event.',
          },
        ])
        .onConflictDoUpdate({
          target: boardItems.id,
          set: {
            laneId: sql`excluded.lane_id`,
            position: sql`excluded.position`,
            responsibleUserId: sql`excluded.responsible_user_id`,
            dueAt: sql`excluded.due_at`,
            priority: sql`excluded.priority`,
            nextStep: sql`excluded.next_step`,
            notes: sql`excluded.notes`,
            updatedAt: now,
          },
        });

      await tx
        .insert(integrationAuditLog)
        .values([
          {
            id: IDS.auditConnected,
            teamId: IDS.team,
            integrationId: IDS.githubIntegration,
            actorUserId: IDS.owner,
            kind: 'connect',
            payload: { seed: true, provider: 'github' },
            createdAt: new Date('2026-06-18T08:35:00.000Z'),
          },
          {
            id: IDS.auditSynced,
            teamId: IDS.team,
            integrationId: IDS.linearIntegration,
            actorUserId: IDS.owner,
            kind: 'sync_success',
            payload: { seed: true, provider: 'linear', events: 1 },
            createdAt: new Date('2026-06-18T08:45:00.000Z'),
          },
        ])
        .onConflictDoNothing();

      await insertExpandedDemoCorpus(tx);
    });

    if (heavy) {
      await db.transaction(async (tx) => {
        await seedHeavyAcmeLabs(tx, {
          team: IDS.team,
          owner: IDS.owner,
          member: IDS.member,
          board: IDS.board,
          laneTodo: IDS.laneTodo,
          laneDoing: IDS.laneDoing,
          laneDone: IDS.laneDone,
        });
      });
      console.log('[seed-dev] seeded heavy Acme Labs volume for infinite-scroll testing');
    }

    console.log('[seed-dev] seeded Acme Labs demo workspace');
    console.log('[seed-dev] logins (password timeline-dev):');
    for (const person of CORPUS_PEOPLE) {
      console.log(`[seed-dev]   ${person.email} (${person.role}, ${person.title})`);
    }
    console.log('[seed-dev] fake GitHub access token: gho_dev_seed_access_token_123');
    console.log('[seed-dev] fake Linear access token: lin_api_dev_seed_access_token_456');
    console.log('[seed-dev] extra fake tokens are listed in docs/demo-corpus.md');
  } finally {
    await closeDb();
  }
}

function loadDotEnv(path: string): void {
  if (!existsSync(path)) return;
  const body = readFileSync(path, 'utf8');
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (!key || process.env[key] !== undefined) continue;
    process.env[key] = parseDotEnvValue(rawValue ?? '');
  }
}

function parseDotEnvValue(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

main().catch((err: unknown) => {
  console.error('[seed-dev] failed', err);
  process.exit(1);
});
