import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { eventVisibility, rawEvents } from './raw-events.js';
import { teams } from './teams.js';
import { users } from './users.js';

// Phase 9 — Team Document Drive. Folders form a tree (self-referential
// parent_folder_id); documents live in a folder or at the team root
// (folder_id IS NULL). Each upload creates an immutable `document_versions`
// row pointing at a versioned, never-overwritten RustFS object key.
// Processing fans out into `document_chunks` for retrieval + citations.
//
// Visibility re-uses `event_visibility` so the same SQL predicate used for
// raw_events also gates folders/documents — one rule, no enum drift.

export const documentProcessingStatus = pgEnum('document_processing_status', [
  'pending',
  'extracting',
  'chunked',
  'embedded',
  'failed',
]);

export const folders = pgTable(
  'folders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    parentFolderId: uuid('parent_folder_id').references((): AnyPgColumn => folders.id, {
      onDelete: 'cascade',
    }),
    name: text('name').notNull(),
    ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
    visibility: eventVisibility('visibility').notNull().default('team'),
    visibilityUserIds: uuid('visibility_user_ids').array(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('folders_team_parent_idx').on(table.teamId, table.parentFolderId),
    index('folders_team_active_idx')
      .on(table.teamId)
      .where(sql`${table.deletedAt} IS NULL`),
    // Case-insensitive name uniqueness within (team, parent). NULL parent
    // collides naturally with NULL parent — that's what we want (team root
    // can't have two "Contracts" folders). `coalesce` produces a stable key
    // for the NULL-root case.
    uniqueIndex('folders_team_parent_name_unq')
      .on(
        table.teamId,
        sql`COALESCE(${table.parentFolderId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
        sql`lower(${table.name})`,
      )
      .where(sql`${table.deletedAt} IS NULL`),
  ],
);

export const documents = pgTable(
  'documents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    folderId: uuid('folder_id').references(() => folders.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    // FK is added in the migration's ALTER TABLE because documentVersions is
    // declared after this table — Drizzle can't model the back-reference
    // cleanly without a circular import. Nullable until the first version
    // finalises, then pinned to the latest finalised version.
    currentVersionId: uuid('current_version_id'),
    ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
    visibility: eventVisibility('visibility').notNull().default('team'),
    visibilityUserIds: uuid('visibility_user_ids').array(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('documents_team_folder_idx').on(table.teamId, table.folderId),
    index('documents_team_active_idx')
      .on(table.teamId)
      .where(sql`${table.deletedAt} IS NULL`),
    index('documents_team_owner_idx').on(table.teamId, table.ownerUserId),
    uniqueIndex('documents_team_folder_name_unq')
      .on(
        table.teamId,
        sql`COALESCE(${table.folderId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
        sql`lower(${table.name})`,
      )
      .where(sql`${table.deletedAt} IS NULL`),
  ],
);

export const documentVersions = pgTable(
  'document_versions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    objectKey: text('object_key').notNull(),
    // Filled by finalize step after HEAD; nullable while the version row is
    // allocated pre-upload (we issue presigned PUT before the bytes exist).
    byteSize: bigint('byte_size', { mode: 'number' }),
    contentType: text('content_type'),
    checksumSha256: text('checksum_sha256'),
    uploadedByUserId: uuid('uploaded_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    // Set after the upload-event row is written in the same transaction as
    // finalize. Lets a `[doc:..#v..]` citation resolve back to the originating
    // raw_event.
    sourceEventId: uuid('source_event_id').references(() => rawEvents.id, {
      onDelete: 'set null',
    }),
    processingStatus: documentProcessingStatus('processing_status').notNull().default('pending'),
    processingError: text('processing_error'),
    extractionModelVersion: text('extraction_model_version'),
    embeddingModelVersion: text('embedding_model_version'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('document_versions_doc_version_unq').on(table.documentId, table.version),
    index('document_versions_team_idx').on(table.teamId),
    index('document_versions_status_idx').on(table.processingStatus),
  ],
);

export const documentChunks = pgTable(
  'document_chunks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    documentVersionId: uuid('document_version_id')
      .notNull()
      .references(() => documentVersions.id, { onDelete: 'cascade' }),
    chunkIndex: integer('chunk_index').notNull(),
    text: text('text').notNull(),
    tokenCount: integer('token_count').notNull(),
    pageNumber: integer('page_number'),
    summary: text('summary'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('document_chunks_version_index_unq').on(table.documentVersionId, table.chunkIndex),
    index('document_chunks_team_idx').on(table.teamId),
    index('document_chunks_document_idx').on(table.documentId),
  ],
);
