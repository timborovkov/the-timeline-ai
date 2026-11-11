import {
  agentProvisioningAudit,
  agentProvisioningReceipts,
  slackWorkspaces,
  slackWorkspaceTeams,
  integrationWebhookDeliveries,
  integrationWebhookDeliveryTargets,
  billingUsageLedger,
  integrations,
  providerConnections,
  teamProviderResourceShares,
  teams,
  users,
  meetings,
  teamBillingAccounts,
  type Db,
} from '@timeline/db';
import { and, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';

import { createPolarBillingProvider } from '#src/billing/polar.js';
import { settlePendingBillingReservations } from '#src/billing/runtime.js';
import { flushPendingPolarUsageIngest } from '#src/billing/scope.js';
import { decryptJson } from '#src/crypto/secrets.js';
import { getEnv } from '#src/env.js';
import { adminDeprovisionIntegrationWebhookSubscriptions } from '#src/integrations/scope.js';
import { getMeetingBotProvider } from '#src/meeting-bots/index.js';
import { sendMessage } from '#src/messaging/delivery.js';
import { withTeam } from '#src/team-scope.js';

/** Called inside the dedicated system lifecycle scope, never from an impersonated request. */
export function createLifecycleMaintenance(db: Db, teamId: string, authorize: () => Promise<void>) {
  return {
    async cancelRenewal() {
      await authorize();
      const [account] = await db
        .select()
        .from(teamBillingAccounts)
        .where(eq(teamBillingAccounts.teamId, teamId));
      if (!account) return;
      const provider = createPolarBillingProvider();
      const pending = account.pendingEnterpriseTerms as {
        byCheckoutId?: Record<string, unknown>;
        checkoutId?: string;
      } | null;
      const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
      const checkouts = [
        ...new Set([
          ...Object.keys(pending?.byCheckoutId ?? {}),
          ...(team?.lifecycleWork.pendingCheckoutIds ?? []),
        ]),
      ];
      if (pending?.checkoutId) checkouts.push(pending.checkoutId);
      if ((account.polarSubscriptionId || checkouts.length) && !provider)
        throw new Error('billing_provider_unavailable');
      for (const checkout of checkouts) {
        if (!provider) throw new Error('billing_provider_unavailable');
        if ((await provider.expireCheckout(checkout)) === 'still_open')
          throw new Error('checkout_expiry_pending');
      }
      if (account.polarSubscriptionId) {
        if (!provider) throw new Error('billing_provider_unavailable');
        if (!account.polarCustomerId) throw new Error('billing_customer_missing');
        await provider.cancelSubscriptionRenewal(
          account.polarSubscriptionId,
          account.polarCustomerId,
        );
      }
      await db
        .update(teamBillingAccounts)
        .set({ pendingEnterpriseTerms: null, autoReloadEnabled: false })
        .where(eq(teamBillingAccounts.teamId, teamId));
    },
    async notifyRequest() {
      await authorize();
      const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
      if (!team?.deletionRequestedByUserId || !team.lifecycleWork.requestId) return true;
      if (!getEnv().RESEND_API_KEY || !getEnv().TRANSACTIONAL_EMAIL_FROM)
        throw new Error('deletion_notification_not_configured');
      const [requester] = await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, team.deletionRequestedByUserId));
      const admins = [
        ...new Set(
          (getEnv().PLATFORM_ADMIN_EMAILS ?? '')
            .split(',')
            .map((email) => email.trim().toLowerCase())
            .filter(Boolean),
        ),
      ];
      if (!admins.length) throw new Error('platform_admin_notification_not_configured');
      const recipients = [
        ...admins.map((to) => ({ to, admin: true })),
        ...(requester ? [{ to: requester.email, admin: false }] : []),
      ];
      let complete = true;
      for (const recipient of recipients) {
        try {
          const result = await db.transaction(async (tx) =>
            sendMessage(
              'team_deletion',
              { ...recipient, teamId },
              {
                db: tx as unknown as Db,
                teamId,
                dedupeKey: `team-deletion:${team.lifecycleWork.requestId}:${recipient.admin ? 'admin' : 'owner'}:${recipient.to}`,
              },
            ),
          );
          if (!result.ok || (result.skipped && result.skippedStatus !== 'sent')) complete = false;
        } catch {
          complete = false;
        }
      }
      return complete;
    },
    async settlePriorUsage() {
      await authorize();
      await settlePendingBillingReservations(db, teamId);
      await flushPendingPolarUsageIngest({ db, teamId, provider: createPolarBillingProvider() });
      const pending =
        await db.execute(sql`SELECT 1 FROM billing_usage_reservations WHERE team_id = ${teamId}::uuid AND
        (state = 'reserved' OR (state = 'expired' AND (metadata->>'worker_settlement_pending' = 'true' OR metadata->>'provider_completed' = 'true' OR metadata->>'pending_failed_attempt_settlement' = 'true'))) LIMIT 1`);
      const { lifecycleRows } = await import('#src/team-lifecycle/result.js');
      if (lifecycleRows(pending).length) throw new Error('usage_settlement_pending');
      const [account] = await db
        .select()
        .from(teamBillingAccounts)
        .where(eq(teamBillingAccounts.teamId, teamId));
      if (account && !account.shadowBilling && account.arrangement !== 'comped') {
        const unbilled = await db.execute(
          sql`SELECT 1 FROM billing_usage_ledger WHERE team_id = ${teamId}::uuid AND metadata->>'polar_ingest_status' IN ('pending', 'in_progress') LIMIT 1`,
        );
        if (lifecycleRows(unbilled).length) throw new Error('usage_invoice_pending');
      }
    },
    async inventoryConnections() {
      await authorize();
      const rows = await db
        .select({ id: integrations.providerConnectionId })
        .from(integrations)
        .where(eq(integrations.teamId, teamId));
      const shares = await db
        .select({ id: teamProviderResourceShares.providerConnectionId })
        .from(teamProviderResourceShares)
        .where(eq(teamProviderResourceShares.teamId, teamId));
      return [...new Set([...rows, ...shares].flatMap((row) => (row.id ? [row.id] : [])))];
    },
    async inventoryIndirect() {
      await authorize();
      const slack = await db
        .select({ id: slackWorkspaceTeams.workspaceId })
        .from(slackWorkspaceTeams)
        .where(eq(slackWorkspaceTeams.teamId, teamId));
      const deliveries = await db
        .select({ id: integrationWebhookDeliveryTargets.deliveryId })
        .from(integrationWebhookDeliveryTargets)
        .where(eq(integrationWebhookDeliveryTargets.teamId, teamId));
      return {
        slackWorkspaceIds: slack.map((row) => row.id),
        webhookDeliveryIds: deliveries.map((row) => row.id),
      };
    },
    async purgeIndirect(input: { slackWorkspaceIds?: string[]; webhookDeliveryIds?: string[] }) {
      await authorize();
      for (const id of input.slackWorkspaceIds ?? []) {
        await db.transaction(async (tx) => {
          await tx
            .select({ id: slackWorkspaces.id })
            .from(slackWorkspaces)
            .where(eq(slackWorkspaces.id, id))
            .for('update');
          const linked = await tx
            .select({ id: slackWorkspaceTeams.id })
            .from(slackWorkspaceTeams)
            .where(eq(slackWorkspaceTeams.workspaceId, id))
            .limit(1);
          if (!linked.length) await tx.delete(slackWorkspaces).where(eq(slackWorkspaces.id, id));
        });
      }
      for (const id of input.webhookDeliveryIds ?? []) {
        await db.transaction(async (tx) => {
          await tx
            .select({ id: integrationWebhookDeliveries.id })
            .from(integrationWebhookDeliveries)
            .where(eq(integrationWebhookDeliveries.id, id))
            .for('update');
          const linked = await tx
            .select({ id: integrationWebhookDeliveryTargets.id })
            .from(integrationWebhookDeliveryTargets)
            .where(eq(integrationWebhookDeliveryTargets.deliveryId, id))
            .limit(1);
          if (!linked.length)
            await tx
              .delete(integrationWebhookDeliveries)
              .where(eq(integrationWebhookDeliveries.id, id));
        });
      }
      const grants = await db
        .select({ id: agentProvisioningAudit.grantId })
        .from(agentProvisioningAudit)
        .where(sql`${agentProvisioningAudit.metadata}->>'teamId' = ${teamId}`);
      const grantIds = [...new Set(grants.flatMap((row) => (row.id ? [row.id] : [])))];
      if (grantIds.length) {
        const receipts = await db
          .select()
          .from(agentProvisioningReceipts)
          .where(inArray(agentProvisioningReceipts.grantId, grantIds));
        for (const receipt of receipts) {
          if (!receipt.responseCiphertext || !receipt.responseIv || !receipt.responseTag) continue;
          const response = z.object({ workspace: z.object({ id: z.string() }) }).safeParse(
            decryptJson({
              ciphertext: Buffer.from(receipt.responseCiphertext, 'base64'),
              iv: Buffer.from(receipt.responseIv, 'base64'),
              tag: Buffer.from(receipt.responseTag, 'base64'),
            }),
          );
          if (response.success && response.data.workspace.id === teamId)
            await db
              .delete(agentProvisioningReceipts)
              .where(eq(agentProvisioningReceipts.id, receipt.id));
        }
      }
      // Keep invoice amounts and attribution; discard arbitrary usage metadata.
      await db
        .update(billingUsageLedger)
        .set({ metadata: {} })
        .where(eq(billingUsageLedger.teamId, teamId));
    },
    async stopBots() {
      await authorize();
      const rows = await db
        .select()
        .from(meetings)
        .where(
          and(
            eq(meetings.teamId, teamId),
            isNotNull(meetings.providerBotId),
            inArray(meetings.status, ['pending', 'scheduled', 'joining', 'active', 'processing']),
          ),
        )
        .limit(50);
      for (const meeting of rows) {
        if (!meeting.providerBotId) continue;
        await getMeetingBotProvider().leaveMeeting(meeting.providerBotId);
        await db.transaction(async (tx) => {
          await tx.execute(sql`SELECT set_config('timeline.lifecycle_cleanup', 'on', true)`);
          await tx.update(meetings).set({ status: 'cancelled' }).where(eq(meetings.id, meeting.id));
        });
      }
      return rows.length === 0;
    },
    async disconnectSources() {
      await authorize();
      const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
      const actorId = team?.lifecycleWork.deletionActorUserId;
      if (!actorId) throw new Error('Deletion actor is missing');
      const rows = await db
        .select({ id: integrations.id })
        .from(integrations)
        .where(eq(integrations.teamId, teamId))
        .limit(10);
      for (const integration of rows) {
        await adminDeprovisionIntegrationWebhookSubscriptions(db, integration.id);
        await db.transaction(async (tx) => {
          await tx.execute(sql`SELECT set_config('timeline.lifecycle_cleanup', 'on', true)`);
          await withTeam(tx as unknown as Db, teamId, actorId, {
            skipMembershipCheck: true,
          }).integrations.deleteIntegration(integration.id);
        });
      }
      return rows.length === 0;
    },
    async removeUnusedConnections(ids: string[]) {
      await authorize();
      for (const id of ids) {
        await db.transaction(async (tx) => {
          const [connection] = await tx
            .select()
            .from(providerConnections)
            .where(eq(providerConnections.id, id))
            .for('update');
          if (!connection) return;
          const linked = await tx
            .select({ id: integrations.id })
            .from(integrations)
            .where(and(eq(integrations.providerConnectionId, id), ne(integrations.teamId, teamId)))
            .limit(1);
          const shares = await tx
            .select({ id: teamProviderResourceShares.id })
            .from(teamProviderResourceShares)
            .where(
              and(
                eq(teamProviderResourceShares.providerConnectionId, id),
                ne(teamProviderResourceShares.teamId, teamId),
              ),
            )
            .limit(1);
          if (linked.length || shares.length) return;
          await tx.execute(sql`SELECT set_config('timeline.lifecycle_cleanup', 'on', true)`);
          await withTeam(tx as unknown as Db, teamId, connection.ownerUserId, {
            skipMembershipCheck: true,
          }).integrations.deleteOwnedProviderConnection(id);
        });
      }
    },
    async finish() {
      await authorize();
      await db
        .update(teams)
        .set({
          deletedAt: new Date(),
          name: 'Deleted team',
          slug: `deleted-${teamId}`,
          inboundEmail: null,
          workStyle: null,
          inboundSenderWhitelist: [],
          disabledReason: null,
          agentReporting: { mode: 'on_request', scope: '', revision: '0' },
        })
        .where(eq(teams.id, teamId));
    },
  };
}
