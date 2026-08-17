import { CORPUS_VOLUME_FLOORS } from './catalog.js';
import { CORPUS_LOGIN_EMAILS, CORPUS_PEOPLE } from './people.js';

export interface ExpandedDemoCorpusSnapshot {
  people: number;
  loginEmails: string[];
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
  telegramBindings: number;
  ingestWebhooks: number;
  extraProviders: string[];
  documentChecksums: string[];
  onboardingStepsCompleted: number;
}

export function assertExpandedDemoCorpus(snapshot: ExpandedDemoCorpusSnapshot): void {
  const errors: string[] = [];
  const atLeast = (label: string, actual: number, floor: number): void => {
    if (actual < floor)
      errors.push(`${label}: expected at least ${String(floor)}, got ${String(actual)}`);
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
  atLeast('onboarding steps', snapshot.onboardingStepsCompleted, 11);

  const missingLogins = CORPUS_LOGIN_EMAILS.filter(
    (email) => !snapshot.loginEmails.includes(email),
  );
  if (missingLogins.length > 0) {
    errors.push(`missing demo logins: ${missingLogins.join(', ')}`);
  }
  if (CORPUS_PEOPLE.length !== snapshot.people && snapshot.people < CORPUS_PEOPLE.length) {
    errors.push('not every corpus person is an active team member');
  }
  for (const provider of ['monday', 'sentry', 'google_drive']) {
    if (!snapshot.extraProviders.includes(provider)) {
      errors.push(`missing ${provider} integration`);
    }
  }
  if (snapshot.documentChecksums.length < CORPUS_VOLUME_FLOORS.documents) {
    errors.push('expanded corpus documents are missing downloaded checksums');
  }

  if (errors.length > 0) {
    throw new Error(`Expanded demo corpus verification failed:\n- ${errors.join('\n- ')}`);
  }
}
