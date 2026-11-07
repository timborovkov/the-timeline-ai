import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from '#src/schema/users.js';

export const agentProvisioningGrants = pgTable('agent_provisioning_grants', {
  id: uuid('id').defaultRandom().primaryKey(),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  prefix: text('prefix').notNull(),
  allowance: integer('allowance').notNull(),
  used: integer('used').notNull().default(0),
  allowCapture: boolean('allow_capture').notNull().default(false),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
export const agentProvisioningReceipts = pgTable(
  'agent_provisioning_receipts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    grantId: uuid('grant_id')
      .notNull()
      .references(() => agentProvisioningGrants.id, { onDelete: 'cascade' }),
    idempotencyKey: text('idempotency_key').notNull(),
    payloadHash: text('payload_hash').notNull(),
    responseCiphertext: text('response_ciphertext'),
    responseIv: text('response_iv'),
    responseTag: text('response_tag'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('agent_provisioning_receipt_unq').on(table.grantId, table.idempotencyKey),
  ],
);
export const agentProvisioningAudit = pgTable('agent_provisioning_audit', {
  id: uuid('id').defaultRandom().primaryKey(),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  grantId: uuid('grant_id').references(() => agentProvisioningGrants.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
