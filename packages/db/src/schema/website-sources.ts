import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { teams } from '#src/schema/teams.js';

/** Immutable crawl result; retrying downstream handoffs never re-crawls changed pages. */
export const websiteSources = pgTable('website_sources', {
  id: uuid('id').primaryKey(),
  teamId: uuid('team_id')
    .notNull()
    .references(() => teams.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  websiteSubject: text('website_subject').$type<'own_team' | 'other_company'>().notNull(),
  crawlId: text('crawl_id'),
  pages: jsonb('pages').$type<{ url: string; title: string; text: string }[]>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
