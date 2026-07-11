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
  messagePreferences,
  providerConnections,
  rawEvents,
  reconciliationEvidence,
  reconciliationOutputs,
  reconciliationRuns,
  teamMembers,
  teamProviderResourceShares,
  teams,
  users,
} from '@timeline/db';
import { encryptJson } from '@timeline/shared/crypto';
import { hashPassword } from '@timeline/shared/passwords';
import { and, eq, inArray, or, sql } from 'drizzle-orm';

loadDotEnv(resolve(process.cwd(), '.env'));

const TERMS_VERSION = '2026-06-02';
const PRIVACY_VERSION = '2026-06-02';
const DEV_PASSWORD = 'timeline-dev';

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
const LOCAL_DEV_SEED_OVERRIDE = 'I_UNDERSTAND_THIS_SEEDS_KNOWN_DEV_CREDENTIALS';

function assertDevSeedEnvironment(): void {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  if (!process.env.AUTH_SECRET) throw new Error('AUTH_SECRET is required');
  if (!process.env.SECRETS_ENCRYPTION_KEY) {
    throw new Error('SECRETS_ENCRYPTION_KEY is required to seed fake integration credentials');
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run dev seed with NODE_ENV=production');
  }

  const host = new URL(databaseUrl).hostname.toLowerCase();
  const isLocalDatabase = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (!isLocalDatabase && process.env.ALLOW_DEV_SEED !== LOCAL_DEV_SEED_OVERRIDE) {
    throw new Error(
      `Refusing to seed non-local database host "${host}". Set ALLOW_DEV_SEED=${LOCAL_DEV_SEED_OVERRIDE} only if this is an isolated development database.`,
    );
  }
}

async function assertReservedSeedRowsAreCompatible(db: ReturnType<typeof getDb>): Promise<void> {
  const [reservedUsers, reservedTeams, reservedConnections, reservedIntegrations] =
    await Promise.all([
      db
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(
          or(
            inArray(users.id, [IDS.owner, IDS.member]),
            inArray(users.email, ['owner@timeline.dev', 'member@timeline.dev']),
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
    const expected =
      row.email === 'owner@timeline.dev'
        ? IDS.owner
        : row.email === 'member@timeline.dev'
          ? IDS.member
          : undefined;
    if (expected && row.id !== expected) {
      throw new Error(
        `Cannot seed: ${row.email} already exists with id ${row.id}. Run pnpm dev:wipe or remove the conflicting dev row first.`,
      );
    }
    if (row.id === IDS.owner && row.email !== 'owner@timeline.dev') {
      throw new Error(
        `Cannot seed: reserved owner id ${IDS.owner} already belongs to ${row.email}.`,
      );
    }
    if (row.id === IDS.member && row.email !== 'member@timeline.dev') {
      throw new Error(
        `Cannot seed: reserved member id ${IDS.member} already belongs to ${row.email}.`,
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

async function main(): Promise<void> {
  assertDevSeedEnvironment();

  const db = getDb();
  await assertReservedSeedRowsAreCompatible(db);
  const passwordHash = await hashPassword(DEV_PASSWORD);
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
          inboundSenderWhitelist: ['owner@timeline.dev', 'member@timeline.dev'],
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
        ])
        .onConflictDoNothing();

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
            modelVersion: 'dev-seed',
            extractedAt: now,
          },
          {
            id: IDS.factEmail,
            teamId: IDS.team,
            rawEventId: IDS.eventEmail,
            statement: 'The vendor security appendix needs approval by Friday.',
            confidence: 0.92,
            modelVersion: 'dev-seed',
            extractedAt: now,
          },
          {
            id: IDS.factMeeting,
            teamId: IDS.team,
            rawEventId: IDS.eventMeeting,
            statement: 'Meeting bots should remain transcript-only and consent-gated for beta.',
            confidence: 0.95,
            modelVersion: 'dev-seed',
            extractedAt: now,
          },
        ])
        .onConflictDoNothing();

      await tx
        .insert(factEntities)
        .values([
          { factId: IDS.factKickoff, entityId: IDS.objectProject, role: 'subject' },
          { factId: IDS.factEmail, entityId: IDS.objectTask, role: 'subject' },
          { factId: IDS.factMeeting, entityId: IDS.objectDecision, role: 'subject' },
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
        ])
        .onConflictDoUpdate({
          target: reconciliationEvidence.id,
          set: {
            rawEventId: sql`excluded.raw_event_id`,
            sourcePayloadRef: sql`excluded.source_payload_ref`,
            payloadDigest: sql`excluded.payload_digest`,
            source: sql`excluded.source`,
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
        .onConflictDoNothing();

      await tx
        .insert(taskCategoryAssignments)
        .values({
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
        .onConflictDoNothing();

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
    });

    console.log('[seed-dev] seeded Acme Labs dev workspace');
    console.log(`[seed-dev] owner login: owner@timeline.dev / ${DEV_PASSWORD}`);
    console.log(`[seed-dev] member login: member@timeline.dev / ${DEV_PASSWORD}`);
    console.log('[seed-dev] fake GitHub access token: gho_dev_seed_access_token_123');
    console.log('[seed-dev] fake Linear access token: lin_api_dev_seed_access_token_456');
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
