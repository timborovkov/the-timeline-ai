import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { users } from '#src/schema/users.js';

export type LegalAcceptanceSource = 'credentials_signup' | 'legal_gate' | 'legacy_snapshot';

// Immutable evidence of the legal bundle a user affirmatively accepted.
// A database trigger blocks direct UPDATE/DELETE; only deletion of the parent
// user may cascade for account/privacy erasure. `users.legal_*` remains the
// fast current-state snapshot while this table preserves earlier versions.
export const legalAcceptances = pgTable(
  'legal_acceptances',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    termsVersion: text('terms_version').notNull(),
    privacyVersion: text('privacy_version').notNull(),
    acceptedAt: timestamp('accepted_at', { mode: 'date', withTimezone: true }).notNull(),
    recordedAt: timestamp('recorded_at', { mode: 'date', withTimezone: true })
      .defaultNow()
      .notNull(),
    source: text('source').$type<LegalAcceptanceSource>().notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
  },
  (table) => [
    check(
      'legal_acceptances_source_chk',
      sql`${table.source} IN ('credentials_signup', 'legal_gate', 'legacy_snapshot')`,
    ),
    uniqueIndex('legal_acceptances_user_versions_unq').on(
      table.userId,
      table.termsVersion,
      table.privacyVersion,
    ),
    index('legal_acceptances_user_accepted_idx').on(table.userId, table.acceptedAt),
  ],
);
