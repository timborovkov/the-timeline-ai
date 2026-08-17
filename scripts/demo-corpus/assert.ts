import { DEMO_EVENTS, DEMO_FACTS } from '../demo-fixture.js';

import {
  CORPUS_DOCUMENTS,
  CORPUS_EVENTS,
  CORPUS_FACTS,
  CORPUS_MEETINGS,
  CORPUS_VOLUME_FLOORS,
} from './catalog.js';
import { CORPUS_LOGIN_EMAILS, CORPUS_PEOPLE } from './people.js';
import { CORPUS_SLACK } from './workspace.js';

const REQUIRED_DISABLED_PROVIDERS = [
  'github',
  'linear',
  'monday',
  'sentry',
  'google_drive',
] as const;

export interface ExpandedDemoCorpusSnapshot {
  people: number;
  loginEmails: string[];
  passwordUsableEmails: string[];
  events: number;
  objects: number;
  documents: number;
  meetings: number;
  pendingProposals: number;
  boardItems: number;
  chatSessions: number;
  digests: number;
  facts: number;
  slackWorkspaces: number;
  slackWorkspaceId: string | null;
  slackWorkspaceEnabled: boolean;
  telegramBindings: number;
  ingestWebhooks: number;
  ingestWebhookEventClass: string | null;
  extraProviders: string[];
  disabledIntegrationProviders: string[];
  mcpEnabled: boolean;
  mcpServerCount: number;
  corpusRawEventCount: number;
  northstarRawEventCount: number;
  corpusFactCount: number;
  northstarFactCount: number;
  documentChecksums: string[];
  embeddedCorpusDocumentVersions: number;
  corpusDocumentChunkPointsPresent: number;
  corpusMeetingChunkPointsPresent: number;
  polarDealflowItems: number;
  onboardingStepsCompleted: number;
}

export function assertExpandedDemoCorpus(snapshot: ExpandedDemoCorpusSnapshot): void {
  const errors: string[] = [];
  const atLeast = (label: string, actual: number, floor: number): void => {
    if (actual < floor)
      errors.push(`${label}: expected at least ${String(floor)}, got ${String(actual)}`);
  };
  const exact = (label: string, actual: number, expected: number): void => {
    if (actual !== expected)
      errors.push(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  };

  atLeast('team members', snapshot.people, CORPUS_VOLUME_FLOORS.people);
  atLeast('timeline events', snapshot.events, CORPUS_VOLUME_FLOORS.events);
  atLeast('workspace objects', snapshot.objects, CORPUS_VOLUME_FLOORS.objects);
  atLeast('documents', snapshot.documents, CORPUS_VOLUME_FLOORS.documents);
  atLeast('meetings', snapshot.meetings, CORPUS_VOLUME_FLOORS.meetings);
  atLeast('pending proposals', snapshot.pendingProposals, CORPUS_VOLUME_FLOORS.pendingProposals);
  atLeast('board items', snapshot.boardItems, CORPUS_VOLUME_FLOORS.boardItems);
  atLeast('ask sessions', snapshot.chatSessions, CORPUS_VOLUME_FLOORS.chatSessions);
  atLeast('daily digests', snapshot.digests, CORPUS_VOLUME_FLOORS.digests);
  atLeast('facts', snapshot.facts, CORPUS_VOLUME_FLOORS.facts);
  atLeast('slack workspaces', snapshot.slackWorkspaces, 1);
  atLeast('telegram bindings', snapshot.telegramBindings, 1);
  atLeast('ingest webhooks', snapshot.ingestWebhooks, 1);
  if (snapshot.ingestWebhookEventClass !== 'pulse') {
    errors.push('Ledger ingest webhook Timeline type is missing or not pulse');
  }
  atLeast('onboarding steps', snapshot.onboardingStepsCompleted, 11);
  exact('corpus raw events', snapshot.corpusRawEventCount, CORPUS_EVENTS.length);
  exact('northstar raw events', snapshot.northstarRawEventCount, DEMO_EVENTS.length);
  exact('corpus facts', snapshot.corpusFactCount, CORPUS_FACTS.length);
  exact('northstar facts', snapshot.northstarFactCount, Object.keys(DEMO_FACTS).length);

  const missingLogins = CORPUS_LOGIN_EMAILS.filter(
    (email) => !snapshot.loginEmails.includes(email),
  );
  if (missingLogins.length > 0) {
    errors.push(`missing demo logins: ${missingLogins.join(', ')}`);
  }
  const unusablePasswords = CORPUS_LOGIN_EMAILS.filter(
    (email) => !snapshot.passwordUsableEmails.includes(email),
  );
  if (unusablePasswords.length > 0) {
    errors.push(`password unusable for demo logins: ${unusablePasswords.join(', ')}`);
  }
  exact(
    'embedded corpus document versions',
    snapshot.embeddedCorpusDocumentVersions,
    CORPUS_DOCUMENTS.length,
  );
  exact(
    'corpus document chunk vectors',
    snapshot.corpusDocumentChunkPointsPresent,
    CORPUS_DOCUMENTS.reduce((count, document) => count + document.chunkIds.length, 0),
  );
  exact(
    'corpus meeting chunk vectors',
    snapshot.corpusMeetingChunkPointsPresent,
    CORPUS_MEETINGS.reduce((count, meeting) => count + meeting.chunkIds.length, 0),
  );
  if (snapshot.polarDealflowItems !== 0) {
    errors.push(
      `Polar Studio is on Customer dealflow (${String(snapshot.polarDealflowItems)} active items)`,
    );
  }
  if (CORPUS_PEOPLE.length !== snapshot.people && snapshot.people < CORPUS_PEOPLE.length) {
    errors.push('not every corpus person is an active team member');
  }
  for (const provider of REQUIRED_DISABLED_PROVIDERS) {
    if (!snapshot.extraProviders.includes(provider)) {
      errors.push(`missing ${provider} integration`);
    }
    if (!snapshot.disabledIntegrationProviders.includes(provider)) {
      errors.push(`${provider} integration is missing or enabled`);
    }
  }
  if (snapshot.mcpServerCount !== 1) {
    errors.push('Ledger MCP server is missing');
  }
  if (snapshot.mcpEnabled) {
    errors.push('Ledger MCP server is enabled');
  }
  if (snapshot.slackWorkspaceId !== CORPUS_SLACK.workspace) {
    errors.push('Acme Labs Slack workspace mapping is missing');
  }
  if (!snapshot.slackWorkspaceEnabled) {
    errors.push('Acme Labs Slack workspace mapping is disabled');
  }
  if (snapshot.documentChecksums.length !== CORPUS_DOCUMENTS.length) {
    errors.push('expanded corpus documents are missing downloaded checksums');
  }

  if (errors.length > 0) {
    throw new Error(`Expanded demo corpus verification failed:\n- ${errors.join('\n- ')}`);
  }
}
