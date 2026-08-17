import type { Db } from '@timeline/db';
import {
  agentSuggestionEvidence,
  agentSuggestionItems,
  agentSuggestions,
  artifactClusters,
  artifactEvidenceAssociations,
  boardItems,
  boardLanes,
  boards,
  calendarEvents,
  chatMessages,
  chatSessions,
  conversationReviews,
  dailyDigests,
  documentChunks,
  documents,
  documentVersions,
  entities,
  entityRelationships,
  factEntities,
  facts,
  folders,
  ingestWebhookCredentials,
  ingestWebhooks,
  integrationSelections,
  integrations,
  integrationSyncState,
  mcpOutboundKeys,
  mcpServers,
  meetingTranscriptChunks,
  meetings,
  messageDeliveries,
  messagePreferences,
  objectNotes,
  objectSummaries,
  providerConnections,
  rawEvents,
  reconciliationEvidence,
  savedMeetings,
  slackConversationBindings,
  slackUsers,
  slackUserTeams,
  slackWorkspaces,
  slackWorkspaceTeams,
  teamDigestDestinations,
  teamMeetingSettings,
  teamMembers,
  teamOnboardingCompletions,
  teamProviderResourceShares,
  telegramChatBindings,
  telegramUsers,
  telegramUserTeams,
  userOnboardingDismissals,
  userPins,
  users,
} from '@timeline/db';
import { encryptJson } from '@timeline/shared/crypto';
import { hashCredential } from '@timeline/shared/ingest-webhooks';
import { hashKey } from '@timeline/shared/mcp-server';
import { hashPassword } from '@timeline/shared/passwords';
import { and, eq, sql } from 'drizzle-orm';

import { DEMO_FIXTURE_VERSION, DEMO_IDS } from '../demo-fixture.js';

import {
  CORPUS_CALENDAR_EVENTS,
  CORPUS_CHATS,
  CORPUS_CONNECTIONS,
  CORPUS_DIGEST_WINDOWS,
  CORPUS_INTEGRATIONS,
  CORPUS_MCP,
  CORPUS_NOTES,
  CORPUS_ONBOARDING_STEPS,
  CORPUS_PINS,
  CORPUS_PROPOSALS,
  CORPUS_SLACK,
  CORPUS_TELEGRAM,
  CORPUS_WEBHOOK,
  DEALFLOW_BOARD,
  DEALFLOW_ITEMS,
  SERIES_A_BOARD,
  SERIES_A_ITEMS,
  boardLaneId,
  dealflowEntityId,
} from './workspace.js';
import {
  CORPUS_DOCUMENTS,
  CORPUS_EVENTS,
  CORPUS_FACTS,
  CORPUS_FOLDERS,
  CORPUS_MEETINGS,
  CORPUS_OBJECTS,
  CORPUS_SAVED_MEETING,
  CORPUS_SECRETS,
  TEAM_ID,
} from './catalog.js';
import { CORPUS_PEOPLE, CORPUS_PERSON, CORPUS_PASSWORD } from './people.js';
import { CORPUS_UUID } from './ids.js';

type SeedTx = Parameters<Parameters<Db['transaction']>[0]>[0];

function clusterKindFor(
  type: (typeof CORPUS_OBJECTS)[number]['type'],
):
  | 'customer_project'
  | 'account'
  | 'incident'
  | 'deal'
  | 'decision'
  | 'task'
  | 'topic'
  | 'person_context'
  | 'other' {
  if (type === 'project') return 'customer_project';
  if (type === 'company' || type === 'vendor') return 'account';
  if (type === 'incident') return 'incident';
  if (type === 'deal') return 'deal';
  if (type === 'decision') return 'decision';
  if (type === 'task' || type === 'follow_up') return 'task';
  if (type === 'topic') return 'topic';
  if (type === 'person') return 'person_context';
  return 'other';
}

function evidenceIdForEvent(eventId: string): string {
  const index = CORPUS_EVENTS.findIndex((row) => row.id === eventId);
  if (index < 0) throw new Error(`Missing corpus event ${eventId} for evidence`);
  return CORPUS_UUID.evidence(index + 1);
}

function clusterIdForEntity(entityId: string): string {
  if (entityId === DEMO_IDS.objectPilot) return DEMO_IDS.clusterPilot;
  if (entityId === DEMO_IDS.objectDelivery) return DEMO_IDS.clusterDelivery;
  if (entityId === DEMO_IDS.objectDecision) return DEMO_IDS.clusterDecision;
  const index = CORPUS_OBJECTS.findIndex((row) => row.id === entityId);
  if (index < 0) throw new Error(`Missing corpus object ${entityId} for cluster`);
  return CORPUS_UUID.cluster(index + 1);
}

const NOW = new Date('2026-08-14T18:00:00.000Z');

export async function insertExpandedDemoCorpus(tx: SeedTx): Promise<void> {
  const passwordHash = await hashPassword(CORPUS_PASSWORD);
  await insertPeople(tx, passwordHash);
  await insertConnections(tx);
  await insertCaptureSurfaces(tx);
  await insertEventsAndFacts(tx);
  await insertObjects(tx);
  await insertDocuments(tx);
  await insertMeetings(tx);
  await insertBoards(tx);
  await insertCalendar(tx);
  await insertProposals(tx);
  await insertChats(tx);
  await insertDigests(tx);
  await insertPinsNotesOnboarding(tx);
}

async function insertPeople(tx: SeedTx, passwordHash: string): Promise<void> {
  await tx
    .insert(users)
    .values(
      CORPUS_PEOPLE.filter(
        (person) => person.id !== DEMO_IDS.owner && person.id !== DEMO_IDS.member,
      ).map((person) => ({
        id: person.id,
        name: person.name,
        email: person.email,
        emailVerified: NOW,
        passwordHash,
        legalTermsVersion: '2026-06-02',
        legalPrivacyVersion: '2026-06-02',
        legalAcceptedAt: NOW,
      })),
    )
    .onConflictDoUpdate({
      target: users.email,
      set: {
        name: sql`excluded.name`,
        emailVerified: sql`excluded."emailVerified"`,
        passwordHash: sql`excluded.password_hash`,
        legalTermsVersion: sql`excluded.legal_terms_version`,
        legalPrivacyVersion: sql`excluded.legal_privacy_version`,
        legalAcceptedAt: sql`excluded.legal_accepted_at`,
        updatedAt: NOW,
      },
    });

  await tx
    .insert(teamMembers)
    .values(
      CORPUS_PEOPLE.filter(
        (person) => person.id !== DEMO_IDS.owner && person.id !== DEMO_IDS.member,
      ).map((person) => ({
        teamId: TEAM_ID,
        userId: person.id,
        role: person.role,
      })),
    )
    .onConflictDoUpdate({
      target: [teamMembers.teamId, teamMembers.userId],
      set: { role: sql`excluded.role`, removedAt: null, removedByUserId: null },
    });

  await tx
    .insert(messagePreferences)
    .values(
      CORPUS_PEOPLE.map((person) => ({
        teamId: TEAM_ID,
        userId: person.id,
        dailyDigestEnabled: false,
        dailyDigestHour: 7,
        timezone: person.timezone,
      })),
    )
    .onConflictDoUpdate({
      target: [messagePreferences.teamId, messagePreferences.userId],
      targetWhere: sql`${messagePreferences.teamId} IS NOT NULL AND ${messagePreferences.userId} IS NOT NULL`,
      set: {
        dailyDigestEnabled: sql`excluded.daily_digest_enabled`,
        dailyDigestHour: sql`excluded.daily_digest_hour`,
        timezone: sql`excluded.timezone`,
        updatedAt: NOW,
      },
    });
}

async function insertConnections(tx: SeedTx): Promise<void> {
  const mondaySecret = encryptJson({
    access_token: CORPUS_SECRETS.mondayAccess,
    expires_at: '2026-12-31T23:59:59.000Z',
  });
  const sentrySecret = encryptJson({
    access_token: CORPUS_SECRETS.sentryAccess,
    expires_at: '2026-12-31T23:59:59.000Z',
  });
  const driveSecret = encryptJson({
    access_token: CORPUS_SECRETS.driveAccess,
    refresh_token: '1//dev_seed_drive_refresh',
    expires_at: '2026-12-31T23:59:59.000Z',
  });
  const mcpAuth = encryptJson({ token: CORPUS_SECRETS.mcpInboundBearer });

  await tx
    .insert(providerConnections)
    .values([
      {
        id: CORPUS_CONNECTIONS.monday,
        ownerUserId: DEMO_IDS.owner,
        provider: 'monday',
        displayName: 'Acme Monday.com',
        externalAccountId: 'monday-account-acme-dev',
        scopes: ['boards:read', 'boards:write'],
        authSecretCiphertext: mondaySecret.ciphertext,
        authSecretIv: mondaySecret.iv,
        authSecretTag: mondaySecret.tag,
        lastConnectedAt: NOW,
      },
      {
        id: CORPUS_CONNECTIONS.sentry,
        ownerUserId: CORPUS_PERSON.jordan.id,
        provider: 'sentry',
        displayName: 'Acme Sentry',
        externalAccountId: 'sentry-org-acme-dev',
        scopes: ['org:read', 'event:read'],
        authSecretCiphertext: sentrySecret.ciphertext,
        authSecretIv: sentrySecret.iv,
        authSecretTag: sentrySecret.tag,
        lastConnectedAt: NOW,
      },
      {
        id: CORPUS_CONNECTIONS.drive,
        ownerUserId: DEMO_IDS.owner,
        provider: 'google_drive',
        displayName: 'Acme Drive',
        externalAccountId: 'drive-user-avery-dev',
        scopes: ['https://www.googleapis.com/auth/drive.readonly'],
        authSecretCiphertext: driveSecret.ciphertext,
        authSecretIv: driveSecret.iv,
        authSecretTag: driveSecret.tag,
        lastConnectedAt: NOW,
      },
    ])
    .onConflictDoNothing();

  await tx
    .insert(integrations)
    .values([
      {
        id: CORPUS_INTEGRATIONS.monday,
        teamId: TEAM_ID,
        connectedByUserId: DEMO_IDS.owner,
        providerConnectionId: CORPUS_CONNECTIONS.monday,
        provider: 'monday',
        displayName: 'Monday.com: Launch',
        externalAccountId: 'monday-account-acme-dev',
        visibilityDefault: 'team',
        enabled: false,
        lastSyncedAt: new Date('2026-08-12T16:30:00.000Z'),
      },
      {
        id: CORPUS_INTEGRATIONS.sentry,
        teamId: TEAM_ID,
        connectedByUserId: CORPUS_PERSON.jordan.id,
        providerConnectionId: CORPUS_CONNECTIONS.sentry,
        provider: 'sentry',
        displayName: 'Sentry: atlas',
        externalAccountId: 'sentry-org-acme-dev',
        visibilityDefault: 'team',
        enabled: false,
        lastSyncedAt: new Date('2026-08-03T09:50:00.000Z'),
      },
      {
        id: CORPUS_INTEGRATIONS.drive,
        teamId: TEAM_ID,
        connectedByUserId: DEMO_IDS.owner,
        providerConnectionId: CORPUS_CONNECTIONS.drive,
        provider: 'google_drive',
        displayName: 'Google Drive: Acme shared',
        externalAccountId: 'drive-user-avery-dev',
        visibilityDefault: 'team',
        enabled: false,
        lastSyncedAt: new Date('2026-08-11T13:20:00.000Z'),
      },
    ])
    .onConflictDoNothing();

  await tx
    .insert(teamProviderResourceShares)
    .values([
      {
        id: CORPUS_UUID.share(1),
        teamId: TEAM_ID,
        providerConnectionId: CORPUS_CONNECTIONS.monday,
        resourceKind: 'monday.board',
        externalId: '1234567890',
        externalLabel: 'Launch',
      },
      {
        id: CORPUS_UUID.share(2),
        teamId: TEAM_ID,
        providerConnectionId: CORPUS_CONNECTIONS.sentry,
        resourceKind: 'sentry.project',
        externalId: 'acme/atlas',
        externalLabel: 'acme/atlas',
      },
      {
        id: CORPUS_UUID.share(3),
        teamId: TEAM_ID,
        providerConnectionId: CORPUS_CONNECTIONS.drive,
        resourceKind: 'drive.folder',
        externalId: 'root',
        externalLabel: 'My Drive (root)',
      },
    ])
    .onConflictDoNothing();

  await tx
    .insert(integrationSelections)
    .values([
      {
        id: CORPUS_UUID.selection(1),
        integrationId: CORPUS_INTEGRATIONS.monday,
        resourceShareId: CORPUS_UUID.share(1),
        selectionKind: 'monday.board',
        externalId: '1234567890',
        externalLabel: 'Launch',
        visibility: 'team',
      },
      {
        id: CORPUS_UUID.selection(2),
        integrationId: CORPUS_INTEGRATIONS.sentry,
        resourceShareId: CORPUS_UUID.share(2),
        selectionKind: 'sentry.project',
        externalId: 'acme/atlas',
        externalLabel: 'acme/atlas',
        visibility: 'team',
      },
      {
        id: CORPUS_UUID.selection(3),
        integrationId: CORPUS_INTEGRATIONS.drive,
        resourceShareId: CORPUS_UUID.share(3),
        selectionKind: 'drive.folder',
        externalId: 'root',
        externalLabel: 'My Drive (root)',
        visibility: 'team',
      },
    ])
    .onConflictDoNothing();

  await tx
    .insert(integrationSyncState)
    .values([
      {
        id: CORPUS_UUID.sync(1),
        integrationId: CORPUS_INTEGRATIONS.monday,
        resourceType: 'monday.board',
        cursor: { since: '2026-08-12T16:30:00.000Z' },
        lastRunAt: new Date('2026-08-12T16:30:00.000Z'),
        lastStatus: 'ok',
      },
      {
        id: CORPUS_UUID.sync(2),
        integrationId: CORPUS_INTEGRATIONS.sentry,
        resourceType: 'sentry.project:acme/atlas',
        cursor: { since: '2026-08-03T09:50:00.000Z' },
        lastRunAt: new Date('2026-08-03T09:50:00.000Z'),
        lastStatus: 'ok',
      },
    ])
    .onConflictDoNothing();

  await tx
    .insert(mcpServers)
    .values({
      id: CORPUS_MCP.inbound,
      teamId: TEAM_ID,
      addedByUserId: DEMO_IDS.owner,
      name: 'Ledger MCP',
      url: 'https://mcp.ledger.example.com/mcp',
      authType: 'bearer',
      authConfigCiphertext: mcpAuth.ciphertext,
      authConfigIv: mcpAuth.iv,
      authConfigTag: mcpAuth.tag,
      enabled: false,
      cachedTools: [{ name: 'ledger.list_invoices', description: 'List fictional invoices' }],
      toolsCachedAt: NOW,
      lastConnectedAt: new Date('2026-07-24T06:00:00.000Z'),
      lastError: 'Demo seed: outbound MCP sync stays disabled',
    })
    .onConflictDoNothing();

  await tx
    .insert(mcpOutboundKeys)
    .values({
      id: CORPUS_MCP.outbound,
      teamId: TEAM_ID,
      createdByUserId: DEMO_IDS.owner,
      name: 'Cursor demo reader',
      keyHash: hashKey(CORPUS_SECRETS.mcpOutbound),
      keyPrefix: CORPUS_SECRETS.mcpOutbound.slice(0, 12),
      scopes: ['read'],
    })
    .onConflictDoNothing();
}

async function insertCaptureSurfaces(tx: SeedTx): Promise<void> {
  const slackToken = encryptJson({ accessToken: CORPUS_SECRETS.slackBot });
  await tx
    .insert(slackWorkspaces)
    .values({
      id: CORPUS_SLACK.workspace,
      slackTeamId: 'T0ACMEDEMO',
      name: 'Acme Labs',
      domain: 'acme-labs',
      botUserId: 'U0TIMELINEBOT',
      appId: 'A0DEMOSEED',
      scopes: ['chat:write', 'commands', 'channels:history'],
      tokenCiphertext: slackToken.ciphertext,
      tokenIv: slackToken.iv,
      tokenTag: slackToken.tag,
      installedByUserId: DEMO_IDS.owner,
    })
    .onConflictDoNothing();

  await tx
    .insert(slackWorkspaceTeams)
    .values({
      id: CORPUS_SLACK.workspaceTeam,
      workspaceId: CORPUS_SLACK.workspace,
      teamId: TEAM_ID,
      installedByUserId: DEMO_IDS.owner,
      enabled: true,
    })
    .onConflictDoNothing();

  await tx
    .insert(slackConversationBindings)
    .values([
      {
        id: CORPUS_SLACK.productBinding,
        workspaceId: CORPUS_SLACK.workspace,
        teamId: TEAM_ID,
        slackConversationId: 'C0PRODUCT',
        conversationType: 'channel',
        title: '#product',
        boundByUserId: DEMO_IDS.owner,
        visibilityDefault: 'team',
        enabled: true,
      },
      {
        id: CORPUS_SLACK.gtmBinding,
        workspaceId: CORPUS_SLACK.workspace,
        teamId: TEAM_ID,
        slackConversationId: 'C0GTM',
        conversationType: 'channel',
        title: '#gtm',
        boundByUserId: CORPUS_PERSON.casey.id,
        visibilityDefault: 'team',
        enabled: true,
      },
      {
        id: CORPUS_SLACK.engBinding,
        workspaceId: CORPUS_SLACK.workspace,
        teamId: TEAM_ID,
        slackConversationId: 'C0ENG',
        conversationType: 'channel',
        title: '#eng',
        boundByUserId: CORPUS_PERSON.jordan.id,
        visibilityDefault: 'team',
        enabled: true,
      },
    ])
    .onConflictDoNothing();

  const slackUserRows = CORPUS_PEOPLE.map((person, index) => ({
    id: CORPUS_UUID.slack(10 + index),
    workspaceId: CORPUS_SLACK.workspace,
    slackUserId: `U0${person.key.toUpperCase()}`,
    name: person.key,
    realName: person.name,
    email: person.email,
  }));
  await tx.insert(slackUsers).values(slackUserRows).onConflictDoNothing();
  await tx
    .insert(slackUserTeams)
    .values(
      slackUserRows.map((row, index) => ({
        id: CORPUS_UUID.slack(20 + index),
        slackUserId: row.id,
        teamId: TEAM_ID,
        userId: CORPUS_PEOPLE[index]?.id ?? DEMO_IDS.owner,
        linkedByUserId: DEMO_IDS.owner,
        isActive: true,
      })),
    )
    .onConflictDoNothing();

  await tx
    .insert(telegramUsers)
    .values([
      {
        id: CORPUS_TELEGRAM.avery,
        tgUserId: 710000001,
        username: 'averytimeline',
        firstName: 'Avery',
        lastName: 'Timeline',
        userId: DEMO_IDS.owner,
      },
      {
        id: CORPUS_TELEGRAM.mika,
        tgUserId: 710000002,
        username: 'mikaproduct',
        firstName: 'Mika',
        lastName: 'Product',
        userId: DEMO_IDS.member,
      },
    ])
    .onConflictDoNothing();
  await tx
    .insert(telegramUserTeams)
    .values([
      {
        telegramUserId: CORPUS_TELEGRAM.avery,
        teamId: TEAM_ID,
        linkedByUserId: DEMO_IDS.owner,
        isActive: true,
      },
      {
        telegramUserId: CORPUS_TELEGRAM.mika,
        teamId: TEAM_ID,
        linkedByUserId: DEMO_IDS.owner,
        isActive: true,
      },
    ])
    .onConflictDoNothing();
  await tx
    .insert(telegramChatBindings)
    .values({
      id: CORPUS_TELEGRAM.leadership,
      tgChatId: -100710000003,
      teamId: TEAM_ID,
      boundByUserId: DEMO_IDS.owner,
      title: 'Acme leadership',
    })
    .onConflictDoNothing();

  await tx
    .insert(ingestWebhooks)
    .values({
      id: CORPUS_WEBHOOK.id,
      teamId: TEAM_ID,
      ownerUserId: CORPUS_PERSON.jordan.id,
      name: 'Ledger billing',
      visibilityDefault: 'team',
      proposalGenerationEnabled: true,
    })
    .onConflictDoNothing();
  await tx
    .insert(ingestWebhookCredentials)
    .values({
      id: CORPUS_WEBHOOK.credentialId,
      teamId: TEAM_ID,
      webhookId: CORPUS_WEBHOOK.id,
      createdByUserId: CORPUS_PERSON.jordan.id,
      keyHash: hashCredential(CORPUS_SECRETS.ingestWebhook),
      keyPrefix: CORPUS_SECRETS.ingestWebhook.slice(0, 12),
      lastUsedAt: new Date('2026-08-13T07:05:00.000Z'),
    })
    .onConflictDoNothing();

  await tx
    .insert(teamDigestDestinations)
    .values([
      {
        id: CORPUS_UUID.digest(200),
        teamId: TEAM_ID,
        kind: 'slack_channel',
        targetId: 'C0PRODUCT',
        label: '#product',
        enabled: false,
        createdByUserId: DEMO_IDS.owner,
      },
      {
        id: CORPUS_UUID.digest(201),
        teamId: TEAM_ID,
        kind: 'telegram_chat',
        targetId: '-100710000003',
        label: 'Acme leadership',
        enabled: false,
        createdByUserId: DEMO_IDS.owner,
      },
    ])
    .onConflictDoNothing();
}

async function insertEventsAndFacts(tx: SeedTx): Promise<void> {
  await tx
    .insert(rawEvents)
    .values(
      CORPUS_EVENTS.map((row) => ({
        id: row.id,
        teamId: TEAM_ID,
        authorUserId: row.authorId,
        source: row.source,
        contentText: row.contentText,
        occurredAt: new Date(row.occurredAt),
        createdAt: new Date(row.occurredAt),
        visibility: 'team' as const,
        sourceMetadata: row.sourceMetadata,
      })),
    )
    .onConflictDoNothing();

  await tx
    .insert(facts)
    .values(
      CORPUS_FACTS.map((row) => ({
        id: row.id,
        teamId: TEAM_ID,
        rawEventId: row.rawEventId,
        statement: row.statement,
        confidence: 0.94,
        modelVersion: DEMO_FIXTURE_VERSION,
        extractedAt: NOW,
      })),
    )
    .onConflictDoNothing();

  await tx
    .insert(factEntities)
    .values(
      CORPUS_FACTS.map((row) => ({ factId: row.id, entityId: row.entityId, role: 'subject' })),
    )
    .onConflictDoNothing();

  await tx
    .insert(reconciliationEvidence)
    .values(
      CORPUS_EVENTS.map((row, index) => ({
        id: CORPUS_UUID.evidence(index + 1),
        teamId: TEAM_ID,
        rawEventId: row.id,
        sourcePayloadRef: String(row.sourceMetadata.source_payload_ref ?? ''),
        payloadDigest: String(row.sourceMetadata.payload_digest ?? ''),
        source: row.source,
        eventType: `${row.source}.captured`,
        occurredAt: new Date(row.occurredAt),
        visibility: 'team' as const,
        visibilityOwnerUserId: null,
        visibilityUserIds: null,
        actor: { user_id: row.authorId },
        contentDigest: `sha256:demo-seed:content:${row.id}`,
        title: row.contentText.slice(0, 80),
        summary: row.contentText.slice(0, 180),
        metadata: { fixture_version: DEMO_FIXTURE_VERSION },
        normalizerVersion: DEMO_FIXTURE_VERSION,
        replayState: 'full' as const,
        dedupeKey: `demo-seed:evidence:${row.id}`,
      })),
    )
    .onConflictDoNothing();
}

async function insertObjects(tx: SeedTx): Promise<void> {
  await tx
    .insert(entities)
    .values(
      CORPUS_OBJECTS.map((row) => ({
        id: row.id,
        teamId: TEAM_ID,
        type: row.type,
        canonicalName: row.canonicalName,
        aliases: row.aliases ?? [],
        metadata: { fixture_version: DEMO_FIXTURE_VERSION, ...row.metadata },
        status: row.status,
        stage: row.stage ?? null,
        priority: row.priority ?? null,
        ownerUserId: row.ownerUserId ?? null,
        assigneeUserId: row.assigneeUserId ?? null,
        dueAt: row.dueAt ? new Date(row.dueAt) : null,
        archivedAt: row.status === 'archived' ? NOW : null,
        sourceEventId: null,
        ...(row.type === 'task' && row.taskCategory
          ? {
              taskCategory: row.taskCategory,
              taskCategoryMode: 'automatic' as const,
              taskCategorySource: 'llm' as const,
              taskCategoryStatus: 'ready' as const,
              taskCategoryAppliedInputHash: `demo-seed-task-${row.id}`,
              taskCategoryTaxonomyVersion: 'task-categories-v1',
              taskCategoryUpdatedAt: NOW,
            }
          : {}),
      })),
    )
    .onConflictDoNothing();

  await tx
    .insert(artifactClusters)
    .values(
      CORPUS_OBJECTS.map((row, index) => ({
        id: CORPUS_UUID.cluster(index + 1),
        teamId: TEAM_ID,
        artifactClusterKind: clusterKindFor(row.type),
        artifactType: row.type,
        canonicalName: row.canonicalName,
        status: row.status === 'archived' ? ('archived' as const) : ('active' as const),
        canonicalEntityId: row.id,
        metadata: { fixture_version: DEMO_FIXTURE_VERSION },
      })),
    )
    .onConflictDoNothing();

  const relationships = [
    { from: 'Helio Retail pilot', to: 'Helio Retail', kind: 'related' as const },
    { from: 'Brightline Health', to: 'Dana Cole', kind: 'related' as const },
    { from: 'Northwind Capital lead', to: 'Northwind Capital', kind: 'related' as const },
    { from: 'Northwind Capital lead', to: 'Series A process', kind: 'child' as const },
    { from: 'CSV preview 500s', to: 'CSV importer reliability', kind: 'related' as const },
    { from: 'Product designer', to: 'Maya Chen', kind: 'related' as const },
  ];
  await tx
    .insert(entityRelationships)
    .values(
      relationships.map((row, index) => ({
        id: CORPUS_UUID.relationship(index + 1),
        teamId: TEAM_ID,
        fromEntityId: dealflowEntityId(row.from),
        toEntityId: dealflowEntityId(row.to),
        kind: row.kind,
        createdBy: DEMO_IDS.owner,
      })),
    )
    .onConflictDoNothing();

  await tx
    .insert(objectNotes)
    .values(
      CORPUS_NOTES.map((row) => ({
        id: row.id,
        teamId: TEAM_ID,
        entityId: row.entityId,
        authorUserId: row.authorUserId,
        body: row.body,
        createdAt: NOW,
        updatedAt: NOW,
      })),
    )
    .onConflictDoNothing();

  await tx
    .insert(objectSummaries)
    .values([
      {
        id: CORPUS_UUID.note(10),
        teamId: TEAM_ID,
        entityId: dealflowEntityId('Series A process'),
        status: 'ready',
        summary: {
          overview: 'Northwind is the lead. Data room is open. No term sheet yet.',
          overviewSourceRefs: [],
          currentState: 'Diligence',
          openQuestions: ['Northstar proof date'],
          conflicts: [],
        },
        plainText:
          'Northwind Capital is the Series A lead. Avery sent the data room on 13 August. Linden will follow. Harbor Peak is only a catch-up.',
        sourceRefs: [],
        sourceCounts: { events: 6 },
        generatedAt: NOW,
        model: DEMO_FIXTURE_VERSION,
        promptVersion: DEMO_FIXTURE_VERSION,
      },
      {
        id: CORPUS_UUID.note(11),
        teamId: TEAM_ID,
        entityId: DEMO_IDS.objectPilot,
        status: 'ready',
        summary: {
          overview: 'Northstar remains the design partner proof. Field-mapping is delayed.',
          overviewSourceRefs: [],
          currentState: 'Blocked',
          openQuestions: ['Elena Park confirmation'],
          conflicts: [],
        },
        plainText:
          'The Northstar pilot is still blocked on field-mapping. CSV fallback stands. Review should move to 26 August.',
        sourceRefs: [],
        sourceCounts: { events: 8 },
        generatedAt: NOW,
        model: DEMO_FIXTURE_VERSION,
        promptVersion: DEMO_FIXTURE_VERSION,
      },
    ])
    .onConflictDoNothing();

  await tx
    .insert(artifactEvidenceAssociations)
    .values(
      CORPUS_FACTS.map((row, index) => ({
        id: CORPUS_UUID.association(index + 1),
        teamId: TEAM_ID,
        clusterId: clusterIdForEntity(row.entityId),
        evidenceId: evidenceIdForEvent(row.rawEventId),
        rawEventId: row.rawEventId,
        role: 'update' as const,
        strength: 'human' as const,
        confidence: 'high',
        associationSource: 'human' as const,
        rationale: row.statement,
        sourceRefs: [
          {
            rawEventId: row.rawEventId,
            evidenceId: evidenceIdForEvent(row.rawEventId),
          },
        ],
        visibility: 'team' as const,
        visibilityOwnerUserId: null,
        visibilityUserIds: null,
        visibilityFloor: 'team' as const,
        visibilityFloorOwnerUserId: null,
        visibilityFloorUserIds: null,
        metadata: { fixture_version: DEMO_FIXTURE_VERSION },
        dedupeKey: `demo-seed:assoc:${row.id}`,
      })),
    )
    .onConflictDoNothing();
}

async function insertDocuments(tx: SeedTx): Promise<void> {
  await tx
    .insert(folders)
    .values(
      CORPUS_FOLDERS.map((row) => ({
        id: row.id,
        teamId: TEAM_ID,
        name: row.name,
        ownerUserId: row.ownerUserId,
        visibility: 'team' as const,
      })),
    )
    .onConflictDoNothing();

  for (const doc of CORPUS_DOCUMENTS) {
    await tx
      .insert(documents)
      .values({
        id: doc.id,
        teamId: TEAM_ID,
        fileKind: 'document',
        folderId: doc.folderId,
        name: doc.name,
        currentVersionId: null,
        ownerUserId: doc.ownerUserId,
        visibility: 'team',
        metadata: { fixture_version: DEMO_FIXTURE_VERSION, filename: doc.filename },
        createdAt: new Date(doc.occurredAt),
        updatedAt: new Date(doc.occurredAt),
      })
      .onConflictDoUpdate({
        target: documents.id,
        set: {
          name: sql`excluded.name`,
          folderId: sql`excluded.folder_id`,
          metadata: sql`excluded.metadata`,
          deletedAt: null,
          updatedAt: sql`excluded.updated_at`,
        },
      });
    await tx
      .insert(documentVersions)
      .values({
        id: doc.versionId,
        teamId: TEAM_ID,
        documentId: doc.id,
        version: 1,
        objectKey: doc.objectKey,
        byteSize: doc.byteSize,
        contentType: doc.contentType,
        checksumSha256: doc.checksumSha256,
        uploadedByUserId: doc.ownerUserId,
        processingStatus: 'chunked',
        extractionModelVersion: DEMO_FIXTURE_VERSION,
        embeddingModelVersion: null,
        createdAt: new Date(doc.occurredAt),
      })
      .onConflictDoUpdate({
        target: documentVersions.id,
        set: {
          objectKey: sql`excluded.object_key`,
          byteSize: sql`excluded.byte_size`,
          checksumSha256: sql`excluded.checksum_sha256`,
          processingStatus: sql`excluded.processing_status`,
          processingError: null,
          embeddingModelVersion: null,
        },
      });
    await tx
      .insert(documentChunks)
      .values(
        doc.chunks.map((text, index) => ({
          id: doc.chunkIds[index] ?? CORPUS_UUID.document(900 + index),
          teamId: TEAM_ID,
          documentId: doc.id,
          documentVersionId: doc.versionId,
          chunkIndex: index,
          representationKind: 'source_text' as const,
          text,
          tokenCount: Math.max(8, Math.round(text.split(/\s+/).length * 1.3)),
        })),
      )
      .onConflictDoNothing();
    await tx
      .update(documents)
      .set({ currentVersionId: doc.versionId })
      .where(and(eq(documents.teamId, TEAM_ID), eq(documents.id, doc.id)));
  }
}

async function insertMeetings(tx: SeedTx): Promise<void> {
  await tx
    .insert(teamMeetingSettings)
    .values({
      teamId: TEAM_ID,
      meetingMinutesCap: 600,
      requireHostConsent: true,
      updatedAt: NOW,
    })
    .onConflictDoNothing();

  await tx
    .insert(savedMeetings)
    .values({
      id: CORPUS_SAVED_MEETING.id,
      teamId: TEAM_ID,
      createdByUserId: CORPUS_SAVED_MEETING.createdByUserId,
      title: CORPUS_SAVED_MEETING.title,
      platform: 'meet',
      meetingUrl: CORPUS_SAVED_MEETING.meetingUrl,
      defaultVisibility: 'team',
      permissionConfirmedAt: new Date(CORPUS_SAVED_MEETING.permissionConfirmedAt),
      permissionConfirmedByUserId: DEMO_IDS.owner,
      scheduleConfig: CORPUS_SAVED_MEETING.scheduleConfig,
      durationMinutes: 30,
      autoJoinEnabled: true,
      metadata: { fixture_version: DEMO_FIXTURE_VERSION, silent: true, consent_confirmed: true },
    })
    .onConflictDoNothing();

  await tx
    .insert(meetings)
    .values([
      ...CORPUS_MEETINGS.map((row) => ({
        id: row.id,
        teamId: TEAM_ID,
        createdByUserId: row.createdByUserId,
        savedMeetingId: row.title === 'Weekly product standup' ? CORPUS_SAVED_MEETING.id : null,
        provider: 'demo-fixture',
        platform: row.platform,
        meetingUrl: row.meetingUrl,
        title: row.title,
        status: 'completed' as const,
        defaultVisibility: 'team' as const,
        participants: [{ name: 'Avery Timeline' }, { name: 'Mika Product' }],
        metadata: {
          fixture_version: DEMO_FIXTURE_VERSION,
          silent: true,
          consent_confirmed: true,
        },
        startedAt: new Date(row.startedAt),
        endedAt: new Date(row.endedAt),
        createdAt: new Date(row.startedAt),
        updatedAt: new Date(row.endedAt),
      })),
      {
        id: CORPUS_SAVED_MEETING.upcoming.id,
        teamId: TEAM_ID,
        createdByUserId: DEMO_IDS.owner,
        savedMeetingId: CORPUS_SAVED_MEETING.id,
        provider: 'recall',
        platform: 'meet' as const,
        meetingUrl: CORPUS_SAVED_MEETING.meetingUrl,
        title: CORPUS_SAVED_MEETING.title,
        status: 'scheduled' as const,
        defaultVisibility: 'team' as const,
        participants: [],
        metadata: { fixture_version: DEMO_FIXTURE_VERSION, silent: true, consent_confirmed: true },
        scheduledStartAt: new Date(CORPUS_SAVED_MEETING.upcoming.scheduledStartAt),
        scheduledEndAt: new Date(CORPUS_SAVED_MEETING.upcoming.scheduledEndAt),
        createdAt: NOW,
        updatedAt: NOW,
      },
    ])
    .onConflictDoNothing();

  await tx
    .insert(meetingTranscriptChunks)
    .values(
      CORPUS_MEETINGS.flatMap((meeting) =>
        meeting.transcript.map((chunk, index) => ({
          id: meeting.chunkIds[index] ?? CORPUS_UUID.meeting(300 + index),
          meetingId: meeting.id,
          teamId: TEAM_ID,
          speaker: chunk.speaker,
          text: chunk.text,
          startMs: chunk.startMs,
          endMs: chunk.endMs,
          rawEventId: meeting.rawEventId,
          providerChunkId: `demo-seed:${meeting.id}:${String(index)}`,
          createdAt: new Date(meeting.startedAt),
        })),
      ),
    )
    .onConflictDoNothing();
}

async function insertBoards(tx: SeedTx): Promise<void> {
  await tx
    .insert(boards)
    .values([
      {
        id: DEALFLOW_BOARD.id,
        teamId: TEAM_ID,
        createdBy: CORPUS_PERSON.casey.id,
        name: DEALFLOW_BOARD.name,
        purpose: DEALFLOW_BOARD.purpose,
        templateKind: DEALFLOW_BOARD.templateKind,
        recommendedObjectTypes: DEALFLOW_BOARD.recommendedObjectTypes,
        isShared: true,
      },
      {
        id: SERIES_A_BOARD.id,
        teamId: TEAM_ID,
        createdBy: DEMO_IDS.owner,
        name: SERIES_A_BOARD.name,
        purpose: SERIES_A_BOARD.purpose,
        templateKind: SERIES_A_BOARD.templateKind,
        recommendedObjectTypes: SERIES_A_BOARD.recommendedObjectTypes,
        isShared: true,
      },
    ])
    .onConflictDoNothing();

  await tx
    .insert(boardLanes)
    .values(
      [...DEALFLOW_BOARD.lanes, ...SERIES_A_BOARD.lanes].map((lane) => ({
        id: lane.id,
        teamId: TEAM_ID,
        boardId: DEALFLOW_BOARD.lanes.some((row) => row.id === lane.id)
          ? DEALFLOW_BOARD.id
          : SERIES_A_BOARD.id,
        name: lane.name,
        kind: lane.kind,
        position: lane.position,
      })),
    )
    .onConflictDoNothing();

  await tx
    .insert(boardItems)
    .values([
      ...DEALFLOW_ITEMS.map((item, index) => ({
        id: item.id,
        teamId: TEAM_ID,
        boardId: DEALFLOW_BOARD.id,
        entityId: dealflowEntityId(item.entityName),
        laneId: boardLaneId(DEALFLOW_BOARD, item.laneName),
        position: index,
        responsibleUserId: item.responsibleUserId,
        nextStep: item.nextStep,
      })),
      ...SERIES_A_ITEMS.map((item, index) => ({
        id: item.id,
        teamId: TEAM_ID,
        boardId: SERIES_A_BOARD.id,
        entityId: dealflowEntityId(item.entityName),
        laneId: boardLaneId(SERIES_A_BOARD, item.laneName),
        position: index,
        responsibleUserId: item.responsibleUserId,
        nextStep: item.nextStep,
      })),
    ])
    .onConflictDoNothing();
}

async function insertCalendar(tx: SeedTx): Promise<void> {
  await tx
    .insert(calendarEvents)
    .values(
      CORPUS_CALENDAR_EVENTS.map((row) => ({
        id: row.id,
        teamId: TEAM_ID,
        createdByUserId: row.createdByUserId,
        title: row.title,
        startAt: new Date(row.startAt),
        endAt: new Date(row.endAt),
        timezone: 'Europe/Helsinki',
        visibility: 'team' as const,
        source: 'internal' as const,
        metadata: { fixture_version: DEMO_FIXTURE_VERSION },
        scheduledRawEventId: 'rawEventId' in row ? (row.rawEventId ?? null) : null,
      })),
    )
    .onConflictDoNothing();
}

async function insertProposals(tx: SeedTx): Promise<void> {
  for (const proposal of CORPUS_PROPOSALS) {
    if (!proposal.eventId) {
      throw new Error(`Proposal ${proposal.title} is missing evidence event`);
    }
  }
  const reviewEventId = CORPUS_EVENTS.find((row) =>
    row.contentText.includes('dealflow this week'),
  )?.id;
  if (!reviewEventId) {
    throw new Error('Conversation review is missing the #gtm dealflow event');
  }
  await tx
    .insert(agentSuggestions)
    .values(
      CORPUS_PROPOSALS.map((row) => ({
        id: row.id,
        teamId: TEAM_ID,
        source: row.source,
        status: 'pending' as const,
        title: row.title,
        summary: row.summary,
        reason: row.summary,
        confidence: 'high' as const,
        dedupeKey: `demo-seed:proposal:${row.id}`,
        visibility: 'team' as const,
        metadata: { fixture_version: DEMO_FIXTURE_VERSION },
        createdAt: NOW,
        updatedAt: NOW,
      })),
    )
    .onConflictDoNothing();
  await tx
    .insert(agentSuggestionItems)
    .values(
      CORPUS_PROPOSALS.map((row) => ({
        id: row.itemId,
        suggestionId: row.id,
        teamId: TEAM_ID,
        status: 'pending' as const,
        operation: row.operation,
        targetKind: row.targetKind,
        targetId: 'targetId' in row ? row.targetId : null,
        title: row.title,
        description: row.summary,
        dedupeKey: `demo-seed:proposal-item:${row.itemId}`,
        proposedPayload: row.proposedPayload,
        metadata: { fixture_version: DEMO_FIXTURE_VERSION },
      })),
    )
    .onConflictDoNothing();
  await tx
    .insert(agentSuggestionEvidence)
    .values(
      CORPUS_PROPOSALS.map((row) => ({
        id: row.evidenceId,
        suggestionId: row.id,
        teamId: TEAM_ID,
        rawEventId: row.eventId ?? CORPUS_EVENTS[0]?.id ?? DEMO_IDS.eventNote,
        quote: row.summary,
      })),
    )
    .onConflictDoNothing();

  await tx
    .insert(agentSuggestions)
    .values({
      id: CORPUS_UUID.suggestion(20),
      teamId: TEAM_ID,
      source: 'background',
      status: 'accepted',
      title: 'Record the CSV preview replay decision',
      summary: 'Accepted after the 15 July incident review.',
      dedupeKey: 'demo-seed:proposal:accepted-csv-replay',
      visibility: 'team',
      resolvedByUserId: CORPUS_PERSON.mika.id,
      resolvedAt: new Date('2026-07-15T14:00:00.000Z'),
      metadata: { fixture_version: DEMO_FIXTURE_VERSION },
    })
    .onConflictDoNothing();
  await tx
    .insert(agentSuggestionItems)
    .values({
      id: CORPUS_UUID.suggestion(120),
      suggestionId: CORPUS_UUID.suggestion(20),
      teamId: TEAM_ID,
      status: 'accepted',
      operation: 'create',
      targetKind: 'object',
      targetId: dealflowEntityId('Replay CSV preview from stored bytes'),
      resultId: dealflowEntityId('Replay CSV preview from stored bytes'),
      title: 'Record the CSV preview replay decision',
      dedupeKey: 'demo-seed:proposal-item:accepted-csv-replay',
      proposedPayload: {
        type: 'decision',
        canonicalName: 'Replay CSV preview from stored bytes',
        status: 'accepted',
      },
      resolvedByUserId: CORPUS_PERSON.mika.id,
      resolvedAt: new Date('2026-07-15T14:00:00.000Z'),
    })
    .onConflictDoNothing();

  await tx
    .insert(conversationReviews)
    .values({
      id: CORPUS_UUID.suggestion(30),
      teamId: TEAM_ID,
      conversationKey: `slack:${TEAM_ID}:C0GTM`,
      source: 'slack',
      status: 'pending',
      lastRawEventId: reviewEventId,
      quietUntil: new Date('2026-08-14T18:30:00.000Z'),
      metadata: { fixture_version: DEMO_FIXTURE_VERSION, title: '#gtm' },
    })
    .onConflictDoNothing();
}

async function insertChats(tx: SeedTx): Promise<void> {
  await tx
    .insert(chatSessions)
    .values(
      CORPUS_CHATS.map((row) => ({
        id: row.id,
        teamId: TEAM_ID,
        createdBy: row.userId,
        surface: 'web',
        title: row.title,
        createdAt: new Date(row.createdAt),
        updatedAt: new Date(row.createdAt),
      })),
    )
    .onConflictDoNothing();
  await tx
    .insert(chatMessages)
    .values(
      CORPUS_CHATS.flatMap((row, index) => [
        {
          id: CORPUS_UUID.chat(50 + index * 2),
          teamId: TEAM_ID,
          sessionId: row.id,
          role: 'user' as const,
          authorUserId: row.userId,
          content: {
            ui_message: {
              id: `${row.id}:user`,
              role: 'user',
              parts: [{ type: 'text', text: row.question }],
            },
          },
          createdAt: new Date(row.createdAt),
        },
        {
          id: CORPUS_UUID.chat(51 + index * 2),
          teamId: TEAM_ID,
          sessionId: row.id,
          role: 'assistant' as const,
          content: { text: row.answer, tool_calls: [] },
          createdAt: new Date(new Date(row.createdAt).getTime() + 8_000),
        },
      ]),
    )
    .onConflictDoNothing();
}

async function insertDigests(tx: SeedTx): Promise<void> {
  const deliveries = CORPUS_DIGEST_WINDOWS.map((row, index) => ({
    id: CORPUS_UUID.digest(100 + index),
    intent: 'daily_digest' as const,
    channel: 'in_app_digest' as const,
    teamId: TEAM_ID,
    userId: DEMO_IDS.owner,
    recipientEmail: CORPUS_PERSON.avery.email,
    subject: `Daily digest — ${row.start.slice(0, 10)}`,
    status: 'sent' as const,
    provider: 'demo-seed',
    dedupeKey: `demo-seed:digest-delivery:${row.start}`,
    sentAt: new Date(row.start),
    createdAt: new Date(row.start),
    updatedAt: new Date(row.start),
  }));
  await tx.insert(messageDeliveries).values(deliveries).onConflictDoNothing();
  await tx
    .insert(dailyDigests)
    .values(
      CORPUS_DIGEST_WINDOWS.map((row, index) => {
        const start = new Date(row.start);
        const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
        return {
          id: CORPUS_UUID.digest(index + 1),
          teamId: TEAM_ID,
          userId: DEMO_IDS.owner,
          windowStart: start,
          windowEnd: end,
          summary: row.summary,
          payload: {
            teamName: 'Acme Labs',
            userName: CORPUS_PERSON.avery.name,
            timezone: 'Europe/Helsinki',
            windowStart: start.toISOString(),
            windowEnd: end.toISOString(),
            summary: row.summary,
            pendingApprovals: 14,
            eventCount: 6,
            sourceDistribution: { slack: 2, email: 1, meeting: 1, integration: 2 },
            objectChangesByType: { deal: 1, task: 1 },
            newTeamMembers: [],
            tasks: [],
            upcomingCalendar: [],
            links: [{ label: 'Open Timeline', href: '/app' }],
          },
          status: 'sent' as const,
          deliveryId: deliveries[index]?.id,
          generatedAt: start,
          sentAt: start,
        };
      }),
    )
    .onConflictDoNothing();
}

async function insertPinsNotesOnboarding(tx: SeedTx): Promise<void> {
  await tx
    .insert(userPins)
    .values(
      CORPUS_PINS.map((row, index) => ({
        id: CORPUS_UUID.pin(index + 1),
        teamId: TEAM_ID,
        userId: DEMO_IDS.owner,
        targetKind: row.targetKind,
        targetKey: row.targetKey,
        sortKey: row.sortKey,
      })),
    )
    .onConflictDoNothing();

  await tx
    .insert(teamOnboardingCompletions)
    .values(
      CORPUS_ONBOARDING_STEPS.map((step) => ({
        teamId: TEAM_ID,
        step,
        completedByUserId: DEMO_IDS.owner,
        completedAt: new Date('2026-07-10T12:00:00.000Z'),
      })),
    )
    .onConflictDoNothing();

  await tx
    .insert(userOnboardingDismissals)
    .values({
      teamId: TEAM_ID,
      userId: DEMO_IDS.owner,
      dismissedAt: new Date('2026-07-10T12:05:00.000Z'),
    })
    .onConflictDoNothing();
}
