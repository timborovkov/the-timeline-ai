import {
  billingPolarMembers,
  teamBillingAccounts,
  teamMembers,
  teams,
  users,
  type Db,
} from '@timeline/db';
import { and, asc, eq, isNull } from 'drizzle-orm';

import type { BillingProvider } from '#src/billing/provider.js';

import {
  PolarIdentityError,
  type PolarIdentityApi,
  type PolarMemberIdentity,
} from '#src/billing/polar-identity-api.js';

export interface TeamBillingIdentity {
  customerId: string;
  memberId: string;
  externalCustomerId: string;
}
function identityApi(provider: BillingProvider): PolarIdentityApi {
  if (!provider.identity) throw new PolarIdentityError('configuration', 'identity_api');
  return provider.identity;
}
export async function assertStoredPolarIdentity(
  db: Db,
  teamId: string,
  provider: BillingProvider,
): Promise<string> {
  const api = identityApi(provider);
  const [account] = await db
    .select()
    .from(teamBillingAccounts)
    .where(eq(teamBillingAccounts.teamId, teamId));
  if (
    !account?.polarCustomerId ||
    account.polarServer !== api.server ||
    account.polarOrganizationId !== api.organizationId
  )
    throw new PolarIdentityError('identity_conflict', 'stored_customer');
  const customer = await api.customer(teamId, account.polarCustomerId);
  if (customer?.type !== 'team') throw new PolarIdentityError('identity_conflict', 'customer_type');
  return customer.id;
}

/** Resolve only within an already verified team customer; email recovery is
 * explicit, unique, and cannot override a stored member binding. */
export function resolvePolarOwnerUserId(
  owners: { userId: string; email: string; verified: unknown }[],
  mappings: { userId: string; memberId: string | null }[],
  remoteOwner: PolarMemberIdentity,
  allowRecovery = false,
): string {
  const bindings = mappings.filter((row) => row.memberId === remoteOwner.id);
  if (bindings.length > 1) throw new PolarIdentityError('identity_conflict', 'owner_mapping');
  const boundId = bindings[0]?.userId ?? remoteOwner.external_id;
  const bound = owners.find((person) => person.verified && person.userId === boundId);
  if (bound) return bound.userId;
  const recovered = owners.filter(
    (person) => person.verified && person.email.toLowerCase() === remoteOwner.email.toLowerCase(),
  );
  const recoveredOwner = recovered[0];
  if (allowRecovery && bindings.length === 0 && recovered.length === 1 && recoveredOwner)
    return recoveredOwner.userId;
  throw new PolarIdentityError('identity_conflict', 'owner_mapping');
}

/** Caller authorization and session creation share the account lock with revocation. */
export async function withTeamBillingIdentity<T>(
  input: {
    db: Db;
    teamId: string;
    userId: string;
    provider: BillingProvider;
    convert?: boolean;
  },
  action: (
    identity: TeamBillingIdentity,
    context: { db: Db; account: typeof teamBillingAccounts.$inferSelect },
  ) => Promise<T>,
): Promise<T> {
  const api = identityApi(input.provider);
  // Commit the environment binding as provisioning intent before any remote
  // write. It survives a later rollback and requires provider reconciliation
  // before role removal, even if customer/member IDs never committed.
  await input.db.transaction(async (tx) => {
    const [account] = await tx
      .select()
      .from(teamBillingAccounts)
      .where(eq(teamBillingAccounts.teamId, input.teamId))
      .for('update');
    if (!account) throw new PolarIdentityError('configuration', 'billing_account');
    const [actor] = await tx
      .select({ role: teamMembers.role, verified: users.emailVerified })
      .from(teamMembers)
      .innerJoin(users, eq(users.id, teamMembers.userId))
      .where(
        and(
          eq(teamMembers.teamId, input.teamId),
          eq(teamMembers.userId, input.userId),
          isNull(teamMembers.removedAt),
        ),
      );
    if (!actor || !['owner', 'admin'].includes(actor.role) || !actor.verified)
      throw new PolarIdentityError('forbidden', 'billing_member');
    if (
      (account.polarServer && account.polarServer !== api.server) ||
      (account.polarOrganizationId && account.polarOrganizationId !== api.organizationId)
    )
      throw new PolarIdentityError('identity_conflict', 'environment');
    // Existing mappings without a binding still require explicit conversion.
    if (
      account.polarCustomerId &&
      !input.convert &&
      (!account.polarServer || !account.polarOrganizationId)
    )
      throw new PolarIdentityError('identity_conflict', 'environment');
    await tx
      .update(teamBillingAccounts)
      .set({ polarServer: api.server, polarOrganizationId: api.organizationId })
      .where(eq(teamBillingAccounts.teamId, input.teamId));
  });
  return input.db
    .transaction(async (tx) => {
      const db = tx as unknown as Db;
      const [account] = await db
        .select()
        .from(teamBillingAccounts)
        .where(eq(teamBillingAccounts.teamId, input.teamId))
        .for('update');
      if (!account) throw new PolarIdentityError('configuration', 'billing_account');
      const people = await db
        .select({
          userId: users.id,
          email: users.email,
          name: users.name,
          verified: users.emailVerified,
          role: teamMembers.role,
        })
        .from(teamMembers)
        .innerJoin(users, eq(users.id, teamMembers.userId))
        .where(and(eq(teamMembers.teamId, input.teamId), isNull(teamMembers.removedAt)))
        .orderBy(asc(teamMembers.createdAt), asc(teamMembers.userId));
      const actor = people.find((person) => person.userId === input.userId);
      if (!actor || !['owner', 'admin'].includes(actor.role) || !actor.verified)
        throw new PolarIdentityError('forbidden', 'billing_member');
      const stored = await db
        .select()
        .from(billingPolarMembers)
        .where(eq(billingPolarMembers.teamId, input.teamId));
      if (stored.some((row) => row.pendingRole !== null))
        throw new PolarIdentityError('identity_conflict', 'pending_membership_change');
      if (
        (account.polarCustomerId &&
          !input.convert &&
          (!account.polarServer || !account.polarOrganizationId)) ||
        (account.polarServer && account.polarServer !== api.server) ||
        (account.polarOrganizationId && account.polarOrganizationId !== api.organizationId)
      )
        throw new PolarIdentityError('identity_conflict', 'environment');
      let customer = await api.customer(input.teamId, account.polarCustomerId);
      if (!customer && account.polarCustomerId)
        throw new PolarIdentityError('identity_conflict', 'missing_mapped_customer');
      const owners = people.filter(
        (person) => person.role === 'owner' && person.verified && person.email,
      );
      const owner = owners[0];
      if (!owner?.email) throw new PolarIdentityError('configuration', 'verified_owner');
      const [team] = await db
        .select({ name: teams.name })
        .from(teams)
        .where(eq(teams.id, input.teamId));
      if (!team) throw new PolarIdentityError('identity_conflict', 'team');
      customer ??= await api.create(input.teamId, team.name, {
        userId: owner.userId,
        email: owner.email,
        name: owner.name,
      });
      if (customer.type !== 'team') {
        if (!input.convert) throw new PolarIdentityError('configuration', 'conversion_required');
        const customerEmail = customer.email?.toLowerCase();
        const matchingOwners = owners.filter(
          (person) => person.email.toLowerCase() === customerEmail,
        );
        if (matchingOwners.length !== 1)
          throw new PolarIdentityError('identity_conflict', 'conversion_owner');
        customer = await api.convert(input.teamId, customer.id);
      }
      const members = await api.members(customer.id);
      if (members.filter((member) => member.role === 'owner').length !== 1)
        throw new PolarIdentityError('identity_conflict', 'owner_mapping');
      const remoteOwner = members.find((member) => member.role === 'owner');
      if (!remoteOwner) throw new PolarIdentityError('identity_conflict', 'owner_mapping');
      const ownerId = resolvePolarOwnerUserId(owners, stored, remoteOwner, input.convert);
      let actorMember: PolarMemberIdentity | undefined;
      for (const person of people.filter(
        (person) => ['owner', 'admin'].includes(person.role) && person.verified && person.email,
      )) {
        const saved = stored.find((row) => row.userId === person.userId);
        let existing = members.find(
          (member) => member.id === saved?.memberId || member.external_id === person.userId,
        );
        if (!existing && input.convert)
          existing = members.find(
            (member) => member.id === remoteOwner.id && person.userId === ownerId,
          );
        if (saved?.memberId && existing?.id !== saved.memberId)
          throw new PolarIdentityError('identity_conflict', 'member_mapping');
        if (
          existing &&
          existing.external_id !== person.userId &&
          !(saved?.memberId === existing.id && saved.externalId === existing.external_id) &&
          !(input.convert && existing.id === remoteOwner.id && person.userId === ownerId)
        )
          throw new PolarIdentityError('identity_conflict', 'member_external_id');
        const role = person.userId === ownerId ? 'owner' : 'billing_manager';
        const row = await api.saveMember(
          customer.id,
          { userId: person.userId, email: person.email, name: person.name },
          role,
          existing?.id,
        );
        if (existing && row.external_id !== existing.external_id)
          throw new PolarIdentityError('identity_conflict', 'member_external_id');
        await db
          .insert(billingPolarMembers)
          .values({
            teamId: input.teamId,
            userId: person.userId,
            memberId: row.id,
            externalId: row.external_id,
            role,
          })
          .onConflictDoUpdate({
            target: [billingPolarMembers.teamId, billingPolarMembers.userId],
            set: { memberId: row.id, externalId: row.external_id, role, updatedAt: new Date() },
          });
        if (person.userId === input.userId) actorMember = row;
      }
      if (!actorMember) throw new PolarIdentityError('forbidden', 'portal_member');

      await db
        .update(teamBillingAccounts)
        .set({
          polarCustomerId: customer.id,
          polarOrganizationId: api.organizationId,
          polarServer: api.server,
        })
        .where(eq(teamBillingAccounts.teamId, input.teamId));
      // Commit the verified mapping before creating a payable checkout/session.
      return {
        identity: {
          customerId: customer.id,
          memberId: actorMember.id,
          externalCustomerId: input.teamId,
        },
      };
    })
    .then(async ({ identity }) =>
      input.db.transaction(async (tx) => {
        const db = tx as unknown as Db;
        const [account] = await db
          .select()
          .from(teamBillingAccounts)
          .where(eq(teamBillingAccounts.teamId, input.teamId))
          .for('update');
        if (!account) throw new PolarIdentityError('configuration', 'billing_account');
        const [member] = await db
          .select()
          .from(teamMembers)
          .where(
            and(
              eq(teamMembers.teamId, input.teamId),
              eq(teamMembers.userId, input.userId),
              isNull(teamMembers.removedAt),
            ),
          );
        const pending = await db
          .select()
          .from(billingPolarMembers)
          .where(eq(billingPolarMembers.teamId, input.teamId));
        if (
          !member ||
          !['owner', 'admin'].includes(member.role) ||
          pending.some((row) => row.pendingRole !== null)
        )
          throw new PolarIdentityError('forbidden', 'billing_member');
        return action(identity, { db, account });
      }),
    );
}

/** Persist intent first. A failed provider call or local transaction leaves access blocked. */
export async function preparePolarMembershipChange(input: {
  db: Db;
  teamId: string;
  actorUserId: string;
  userId: string;
  targetRole: string;
  provider: BillingProvider | null;
}): Promise<void> {
  await input.db.transaction(async (tx) => {
    const db = tx as unknown as Db;
    const [account] = await db
      .select()
      .from(teamBillingAccounts)
      .where(eq(teamBillingAccounts.teamId, input.teamId))
      .for('update');
    if (!account) return;
    const [actor] = await db
      .select()
      .from(teamMembers)
      .where(
        and(
          eq(teamMembers.teamId, input.teamId),
          eq(teamMembers.userId, input.actorUserId),
          isNull(teamMembers.removedAt),
        ),
      );
    if (!actor || !['owner', 'admin'].includes(actor.role))
      throw new PolarIdentityError('forbidden', 'membership_change');
    const [target] = await db
      .select()
      .from(teamMembers)
      .where(
        and(
          eq(teamMembers.teamId, input.teamId),
          eq(teamMembers.userId, input.userId),
          isNull(teamMembers.removedAt),
        ),
      );
    if (
      !target ||
      target.role === 'member' ||
      (input.targetRole === 'admin' && target.role !== 'owner') ||
      input.targetRole === 'owner'
    )
      return;
    if (actor.role !== 'owner') throw new PolarIdentityError('forbidden', 'membership_change');
    const pending = await db
      .select()
      .from(billingPolarMembers)
      .where(eq(billingPolarMembers.teamId, input.teamId));
    if (pending.some((row) => row.pendingRole !== null && row.userId !== input.userId))
      throw new PolarIdentityError('identity_conflict', 'pending_membership_change');
    if (target.role === 'owner') {
      const owners = await db
        .select({ id: users.id, verified: users.emailVerified })
        .from(teamMembers)
        .innerJoin(users, eq(users.id, teamMembers.userId))
        .where(
          and(
            eq(teamMembers.teamId, input.teamId),
            eq(teamMembers.role, 'owner'),
            isNull(teamMembers.removedAt),
          ),
        );
      if (!owners.some((owner) => owner.id !== input.userId && owner.verified))
        throw new PolarIdentityError('identity_conflict', 'last_billing_owner');
    }
    const [saved] = await db
      .select()
      .from(billingPolarMembers)
      .where(
        and(
          eq(billingPolarMembers.teamId, input.teamId),
          eq(billingPolarMembers.userId, input.userId),
        ),
      );
    if (
      saved?.pendingRole &&
      saved.pendingRole !== input.targetRole &&
      saved.pendingRole !== `revoke:${input.targetRole}`
    )
      throw new PolarIdentityError('identity_conflict', 'pending_membership_change');
    await db
      .insert(billingPolarMembers)
      .values({
        teamId: input.teamId,
        userId: input.userId,
        pendingRole: `revoke:${input.targetRole}`,
      })
      .onConflictDoUpdate({
        target: [billingPolarMembers.teamId, billingPolarMembers.userId],
        set: { pendingRole: `revoke:${input.targetRole}`, updatedAt: new Date() },
      });
  });
  await input.db.transaction(async (tx) => {
    const db = tx as unknown as Db;
    const [account] = await db
      .select()
      .from(teamBillingAccounts)
      .where(eq(teamBillingAccounts.teamId, input.teamId))
      .for('update');
    const [saved] = await db
      .select()
      .from(billingPolarMembers)
      .where(
        and(
          eq(billingPolarMembers.teamId, input.teamId),
          eq(billingPolarMembers.userId, input.userId),
        ),
      );
    if (!saved?.pendingRole || !account) return;
    const confirmRevocation = () =>
      db
        .update(billingPolarMembers)
        .set({ memberId: null, role: null, pendingRole: input.targetRole })
        .where(eq(billingPolarMembers.id, saved.id));
    if (!input.provider?.identity) {
      if (
        account.polarCustomerId ||
        account.polarServer ||
        account.polarOrganizationId ||
        saved.memberId
      )
        throw new PolarIdentityError('configuration', 'provider');
      await confirmRevocation();
      return;
    }
    const api = identityApi(input.provider);
    if (
      (account.polarServer && account.polarServer !== api.server) ||
      (account.polarOrganizationId && account.polarOrganizationId !== api.organizationId)
    )
      throw new PolarIdentityError('identity_conflict', 'environment');
    let customerId = account.polarCustomerId;
    if (customerId) {
      await assertStoredPolarIdentity(db, input.teamId, input.provider);
    } else {
      // Provisioning can have succeeded remotely while its local transaction
      // rolled back. Only the exact external ID can recover that customer.
      const recovered = await api.customer(input.teamId);
      if (!recovered) {
        await confirmRevocation();
        return;
      }
      if (recovered.type !== 'team')
        throw new PolarIdentityError('configuration', 'conversion_required');
      customerId = recovered.id;
      await db
        .update(teamBillingAccounts)
        .set({
          polarCustomerId: customerId,
          polarServer: api.server,
          polarOrganizationId: api.organizationId,
        })
        .where(eq(teamBillingAccounts.teamId, input.teamId));
    }
    // Customer-level email can receive customer-scoped access links independently
    // of member sessions. Revoking only the member cannot revoke that access.
    const customer = await api.customer(input.teamId, customerId);
    if (customer?.email) await api.clearEmail(input.teamId, customerId);
    const members = await api.members(customerId);
    const target = members.find(
      (member) => member.id === saved.memberId || member.external_id === input.userId,
    );
    if (target?.role === 'owner') {
      const owners = await db
        .select({
          userId: users.id,
          email: users.email,
          name: users.name,
          verified: users.emailVerified,
        })
        .from(teamMembers)
        .innerJoin(users, eq(users.id, teamMembers.userId))
        .where(
          and(
            eq(teamMembers.teamId, input.teamId),
            eq(teamMembers.role, 'owner'),
            isNull(teamMembers.removedAt),
          ),
        )
        .orderBy(asc(teamMembers.createdAt), asc(teamMembers.userId));
      const next = owners.find(
        (owner) => owner.userId !== input.userId && owner.verified && owner.email,
      );
      if (!next?.email) throw new PolarIdentityError('identity_conflict', 'last_billing_owner');
      const [nextMapping] = await db
        .select()
        .from(billingPolarMembers)
        .where(
          and(
            eq(billingPolarMembers.teamId, input.teamId),
            eq(billingPolarMembers.userId, next.userId),
          ),
        );
      const remote = members.find(
        (member) => member.id === nextMapping?.memberId || member.external_id === next.userId,
      );
      const promoted = await api.saveMember(
        customerId,
        { ...next, email: next.email },
        'owner',
        remote?.id,
      );
      await db
        .insert(billingPolarMembers)
        .values({
          teamId: input.teamId,
          userId: next.userId,
          memberId: promoted.id,
          externalId: promoted.external_id,
          role: 'owner',
        })
        .onConflictDoUpdate({
          target: [billingPolarMembers.teamId, billingPolarMembers.userId],
          set: { memberId: promoted.id, externalId: promoted.external_id, role: 'owner' },
        });
    }
    if (target) await api.removeMember(customerId, target.id);
    await confirmRevocation();
  });
}
/** Shared lock order for local role mutations and provider session issuance. */
export async function lockTeamBillingIdentity(db: Db, teamId: string): Promise<void> {
  await db
    .select()
    .from(teamBillingAccounts)
    .where(eq(teamBillingAccounts.teamId, teamId))
    .for('update');
}
/** Call inside the local membership transaction before updating the member row. */
export async function completePolarMembershipChange(
  db: Db,
  teamId: string,
  userId: string,
  targetRole: string,
): Promise<void> {
  await db
    .select()
    .from(teamBillingAccounts)
    .where(eq(teamBillingAccounts.teamId, teamId))
    .for('update');
  const [saved] = await db
    .select()
    .from(billingPolarMembers)
    .where(and(eq(billingPolarMembers.teamId, teamId), eq(billingPolarMembers.userId, userId)));
  // Defense in depth: local role mutation must not finish while its mapped
  // provider member still grants access, even if a caller skipped preparation.
  if (
    saved?.memberId &&
    targetRole !== 'owner' &&
    (targetRole !== 'admin' || saved.role === 'owner')
  )
    throw new PolarIdentityError('identity_conflict', 'revocation_incomplete');
  if (saved?.pendingRole) {
    if (saved.pendingRole !== targetRole || saved.memberId)
      throw new PolarIdentityError('identity_conflict', 'revocation_incomplete');
    await db
      .update(billingPolarMembers)
      .set({ pendingRole: null })
      .where(eq(billingPolarMembers.id, saved.id));
  }
}

/** Refresh an already-linked team after promotions or verified email changes.
 * Access paths retry synchronously and never issue a session on a failed refresh.
 */
export async function synchronizePolarBillingUser(input: {
  db: Db;
  userId: string;
  provider: BillingProvider | null;
}): Promise<void> {
  if (!input.provider) return;
  const memberships = await input.db
    .select({ teamId: teamMembers.teamId, role: teamMembers.role })
    .from(teamMembers)
    .innerJoin(teamBillingAccounts, eq(teamBillingAccounts.teamId, teamMembers.teamId))
    .where(and(eq(teamMembers.userId, input.userId), isNull(teamMembers.removedAt)));
  for (const membership of memberships) {
    if (!['owner', 'admin'].includes(membership.role)) continue;
    const [account] = await input.db
      .select()
      .from(teamBillingAccounts)
      .where(eq(teamBillingAccounts.teamId, membership.teamId));
    if (!account?.polarCustomerId) continue;
    await withTeamBillingIdentity(
      { ...input, provider: input.provider, teamId: membership.teamId },
      () => Promise.resolve(undefined),
    );
  }
}
