import {
  closeDb,
  getDb,
  billingPolarMembers,
  teamBillingAccounts,
  teamMembers,
  users,
} from '@timeline/db';
import { createPolarBillingProvider, withTeamBillingIdentity } from '@timeline/shared/billing';
import { lookupOperatorActor, requirePlatformAdmin } from '@timeline/shared/billing/operator-store';
import { and, asc, eq, isNull } from 'drizzle-orm';

const args = process.argv.slice(2);
const arg = (key: string) =>
  args.find((value) => value.startsWith(`--${key}=`))?.slice(key.length + 3);
const teamId = arg('team-id');
const actorEmail = arg('actor-email');
if (!teamId || !actorEmail) throw new Error('--team-id and --actor-email are required');
const db = getDb();
try {
  // The same verified PLATFORM_ADMIN_EMAILS gate as the operator UI.
  const actor = await lookupOperatorActor(db, actorEmail);
  await requirePlatformAdmin(db, actor);
  const provider = createPolarBillingProvider();
  if (!provider?.identity) throw new Error('Polar identity provider unavailable');
  const [account] = await db
    .select()
    .from(teamBillingAccounts)
    .where(eq(teamBillingAccounts.teamId, teamId));
  if (!account) throw new Error('Billing account not found');
  if (
    (account.polarServer && account.polarServer !== provider.identity.server) ||
    (account.polarOrganizationId &&
      account.polarOrganizationId !== provider.identity.organizationId)
  )
    throw new Error('Stored Polar environment or organization mismatch');
  const mappings = await db
    .select()
    .from(billingPolarMembers)
    .where(eq(billingPolarMembers.teamId, teamId));
  if (mappings.some((row) => row.pendingRole !== null))
    throw new Error('Finish the pending membership operation before conversion');
  const customer = await provider.identity.customer(teamId, account.polarCustomerId);
  if (!customer)
    throw new Error('No existing customer to convert; use team billing setup to create one');
  const owners = await db
    .select({ userId: users.id, email: users.email, verified: users.emailVerified })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(
      and(
        eq(teamMembers.teamId, teamId),
        eq(teamMembers.role, 'owner'),
        isNull(teamMembers.removedAt),
      ),
    )
    .orderBy(asc(teamMembers.createdAt), asc(teamMembers.userId));
  const owner = owners.find((row) => row.verified);
  if (!owner) throw new Error('No verified active owner');
  if (customer.type === 'individual') {
    if (
      owners.filter(
        (row) => row.verified && row.email.toLowerCase() === customer.email?.toLowerCase(),
      ).length !== 1
    )
      throw new Error(
        'Individual customer email must identify exactly one verified active Timeline owner',
      );
  } else {
    const remoteOwners = (await provider.identity.members(customer.id)).filter(
      (row) => row.role === 'owner',
    );
    const remoteOwner = remoteOwners[0];
    if (
      remoteOwners.length !== 1 ||
      !remoteOwner ||
      !owners.some(
        (row) =>
          row.verified &&
          (row.userId === remoteOwner.external_id ||
            mappings.some(
              (mapping) => mapping.userId === row.userId && mapping.memberId === remoteOwner.id,
            )),
      )
    )
      throw new Error('Existing team owner mapping is ambiguous');
  }
  console.log(
    JSON.stringify({
      mode: args.includes('--apply') ? 'apply' : 'dry-run',
      teamId,
      customerId: customer.id,
      currentType: customer.type,
      targetType: 'team',
      server: provider.identity.server,
    }),
  );
  if (args.includes('--apply'))
    await withTeamBillingIdentity(
      { db, teamId, userId: owner.userId, provider, convert: true },
      () => Promise.resolve(undefined),
    );
  if (args.includes('--apply') && customer.email) {
    // Mapping/member conversion has committed. Never erase it when the provider
    // accepts but ignores email:null; report the incomplete cleanup explicitly.
    await provider.identity.clearEmail(teamId, customer.id);
  }
} finally {
  await closeDb();
}
