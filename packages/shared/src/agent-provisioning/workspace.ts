import { type Db, auditLog, teams, teamMembers, teamCalendarSettings } from '@timeline/db';

import {
  applyOwnedTeamFreeGrant,
  insertRestrictedFreeBillingAccount,
} from '#src/billing/capacity.js';
import { insertDefaultDigestDestination } from '#src/messaging/index.js';
import { buildInboundEmail, randomSlugSuffix, slugify } from '#src/slug.js';

type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0];
/** Pre-team creation boundary: caller authenticates the future owner before invoking. */
export async function createOwnedWorkspace(
  tx: Transaction,
  input: { ownerId: string; name: string; timezone: string },
) {
  const slug = `${slugify(input.name) || 'team'}-${randomSlugSuffix()}`;
  const [team] = await tx
    .insert(teams)
    .values({
      name: input.name,
      slug,
      inboundEmail: buildInboundEmail(slug, process.env.INBOUND_EMAIL_DOMAIN),
    })
    .returning({ id: teams.id, name: teams.name, slug: teams.slug });
  if (!team) throw new Error('Workspace creation failed');
  await tx.insert(teamMembers).values({ teamId: team.id, userId: input.ownerId, role: 'owner' });
  await tx
    .insert(teamCalendarSettings)
    .values({ teamId: team.id, defaultTimezone: input.timezone });
  await insertDefaultDigestDestination(tx, team.id);
  await insertRestrictedFreeBillingAccount({ db: tx, teamId: team.id });
  const billing = await applyOwnedTeamFreeGrant({ db: tx, teamId: team.id, userId: input.ownerId });
  await tx.insert(auditLog).values({
    teamId: team.id,
    actorUserId: input.ownerId,
    action: 'workspace.create',
    targetType: 'team',
    targetId: team.id,
    metadata: {},
  });
  return {
    team,
    billing: billing.ok ? { restricted: false } : { restricted: true, reason: billing.reason },
  };
}
