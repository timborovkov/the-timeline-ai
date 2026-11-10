import type { Db } from '@timeline/db';
import { teamFirstRun, teamMembers, teams, users } from '@timeline/db';
import { withTeam } from '@timeline/shared';
import {
  applyOwnedTeamFreeGrant,
  insertRestrictedFreeBillingAccount,
} from '@timeline/shared/billing';
import { PRIVACY_VERSION, TERMS_VERSION } from '@timeline/shared/legal-versions';
import { insertDefaultDigestDestination } from '@timeline/shared/messaging';
import { verifyPassword } from '@timeline/shared/passwords';
import { and, eq, sql } from 'drizzle-orm';

import { getDemoSeedNow } from './demo-clock.js';
import {
  assertEmptyDemoWorkspace,
  DEMO_IDS,
  DEMO_LEGAL_ACCEPTED_AT,
  DEMO_LOGIN_PASSWORD,
  EMPTY_DEMO_LOGIN,
  type EmptyDemoWorkspaceSnapshot,
} from './demo-fixture.js';
import { seedCurrentLegalAcceptances } from './demo-legal.js';

type SeedTx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * First-run onboarding workspace. Bootstrap of user/team/membership cannot go
 * through `withTeam` (the team does not exist yet). Billing, digest, and every
 * later read use team-scoped helpers after membership exists.
 */
export async function seedEmptyOnboardingTeam(tx: SeedTx, passwordHash: string): Promise<void> {
  const createdAt = getDemoSeedNow();

  await tx
    .insert(users)
    .values({
      id: EMPTY_DEMO_LOGIN.id,
      name: EMPTY_DEMO_LOGIN.name,
      email: EMPTY_DEMO_LOGIN.email,
      emailVerified: createdAt,
      passwordHash,
      legalTermsVersion: TERMS_VERSION,
      legalPrivacyVersion: PRIVACY_VERSION,
      legalAcceptedAt: new Date(DEMO_LEGAL_ACCEPTED_AT),
    })
    .onConflictDoUpdate({
      target: users.email,
      set: {
        name: sql`excluded.name`,
        emailVerified: sql`excluded."emailVerified"`,
        passwordHash: sql`excluded.password_hash`,
        legalTermsVersion: sql`excluded.legal_terms_version`,
        legalPrivacyVersion: sql`excluded.legal_privacy_version`,
        legalAcceptedAt: sql`excluded.legal_accepted_at`,
        updatedAt: createdAt,
      },
    });

  await seedCurrentLegalAcceptances(tx, [EMPTY_DEMO_LOGIN.id], new Date(DEMO_LEGAL_ACCEPTED_AT));

  await tx
    .insert(teams)
    .values({
      id: DEMO_IDS.emptyTeam,
      slug: EMPTY_DEMO_LOGIN.teamSlug,
      name: EMPTY_DEMO_LOGIN.teamName,
      inboundEmail: `${EMPTY_DEMO_LOGIN.teamSlug}@inbound.timeline.dev`,
    })
    .onConflictDoUpdate({
      target: teams.slug,
      set: {
        name: sql`excluded.name`,
        inboundEmail: sql`excluded.inbound_email`,
      },
    });

  await tx
    .insert(teamMembers)
    .values({
      teamId: DEMO_IDS.emptyTeam,
      userId: EMPTY_DEMO_LOGIN.id,
      role: EMPTY_DEMO_LOGIN.role,
    })
    .onConflictDoUpdate({
      target: [teamMembers.teamId, teamMembers.userId],
      set: { role: sql`excluded.role`, removedAt: null, removedByUserId: null },
    });

  await tx
    .insert(teamFirstRun)
    .values({
      teamId: DEMO_IDS.emptyTeam,
      startedByUserId: EMPTY_DEMO_LOGIN.id,
      phase: 'welcome',
    })
    .onConflictDoUpdate({
      target: teamFirstRun.teamId,
      set: {
        startedByUserId: EMPTY_DEMO_LOGIN.id,
        phase: 'welcome',
        starterPath: null,
        starterSelectedAt: null,
        captureDocumentId: null,
        captureEventId: null,
        websiteUrl: null,
        websiteHost: null,
        scanFailureReason: null,
        guideHiddenAt: null,
        firstCaptureLandedAt: null,
        updatedAt: createdAt,
      },
    });

  await insertDefaultDigestDestination(tx, DEMO_IDS.emptyTeam);
  await insertRestrictedFreeBillingAccount({ db: tx, teamId: DEMO_IDS.emptyTeam });
  const grant = await applyOwnedTeamFreeGrant({
    db: tx,
    teamId: DEMO_IDS.emptyTeam,
    userId: EMPTY_DEMO_LOGIN.id,
  });
  if (!grant.ok) {
    throw new Error(
      `Empty onboarding team free grant failed (${grant.reason}). Run bun run dev:wipe or remove the conflicting billing grant first.`,
    );
  }
}

export async function readEmptyDemoWorkspaceSnapshot(db: Db): Promise<EmptyDemoWorkspaceSnapshot> {
  const scope = withTeam(db, DEMO_IDS.emptyTeam, EMPTY_DEMO_LOGIN.id);
  const [
    loginRows,
    team,
    account,
    checklist,
    events,
    documents,
    meetings,
    objects,
    integrations,
    connections,
    proposals,
    calendarEvents,
  ] = await Promise.all([
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        passwordHash: users.passwordHash,
        teamId: teamMembers.teamId,
        role: teamMembers.role,
        removedAt: teamMembers.removedAt,
      })
      .from(users)
      .leftJoin(
        teamMembers,
        and(eq(teamMembers.userId, users.id), eq(teamMembers.teamId, DEMO_IDS.emptyTeam)),
      )
      .where(eq(users.id, EMPTY_DEMO_LOGIN.id)),
    scope.timeline.team(),
    scope.billing.getAccount(),
    scope.onboarding.getChecklistState(),
    scope.timeline.listEvents({ limit: 1 }),
    scope.documents.listDocumentsPage({ limit: 1 }),
    scope.meetings.listMeetings({ limit: 1 }),
    scope.objects.listObjects({ limit: 1 }),
    scope.integrations.listIntegrations(),
    scope.integrations.listOwnedProviderConnections(),
    scope.suggestions.listPendingSuggestions(),
    scope.calendar.listCalendarEvents({ limit: 1 }),
  ]);

  const login = loginRows[0];
  const passwordUsable = Boolean(
    login?.passwordHash && (await verifyPassword(DEMO_LOGIN_PASSWORD, login.passwordHash)),
  );

  return {
    workspace: team ? { id: team.id, slug: team.slug, name: team.name } : null,
    login: login
      ? {
          id: login.id,
          name: login.name,
          email: login.email,
          teamId: login.teamId,
          role: login.role,
          membershipActive: login.teamId === DEMO_IDS.emptyTeam && login.removedAt === null,
          passwordUsable,
        }
      : null,
    eventCount: events.length,
    documentCount: documents.items.length,
    meetingCount: meetings.length,
    objectCount: objects.length,
    integrationCount: integrations.length,
    ownedConnectionCount: connections.length,
    pendingProposalCount: proposals.length,
    calendarEventCount: calendarEvents.length,
    onboardingDismissed: checklist.dismissed,
    completedOnboardingSteps: checklist.steps
      .filter((step) => step.completed)
      .map((step) => step.step),
    billingPlanId: account.planId,
    billingState: account.billingState,
    firstRunPhase: (await scope.onboarding.getFirstRun())?.phase ?? null,
  };
}

export async function assertSeededEmptyOnboardingTeam(db: Db): Promise<void> {
  assertEmptyDemoWorkspace(await readEmptyDemoWorkspaceSnapshot(db));
}
