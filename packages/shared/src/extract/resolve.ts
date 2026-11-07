import {
  aliasesArray,
  findEntityMention,
  mapMentionIds,
  type DbOrTx,
  type LookupEntityInput,
} from '#src/extract/lookup.js';
import { type Db, entities } from '@timeline/db';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { type ChatDeps } from '#src/llm/chat.js';
import { childLogger } from '#src/logger.js';
import { enqueueEntityEmbedJob } from '#src/queue/queues.js';

import type { EntityMention } from '#src/extract/schema.js';

const embedLog = childLogger('extract:embed');

function fireAndForgetEntityEmbed(teamId: string, entityId: string): void {
  void enqueueEntityEmbedJob(teamId, entityId).catch((err: unknown) => {
    embedLog.error({ err, teamId, entityId }, 'failed to enqueue entity embed');
  });
}

export type { DbOrTx } from '#src/extract/lookup.js';

export interface ResolveEntityInput extends LookupEntityInput {
  /** Compatibility opt-in; production extraction uses lookupMentions instead. */
  createIfMissing?: boolean;
  updateAliases?: boolean;
}

async function insertEntityRow(tx: DbOrTx, input: ResolveEntityInput): Promise<string> {
  // Race-safe insert: a concurrent worker may have created the same canonical
  // name between our SELECT and this INSERT. The partial unique index
  // `entities_team_type_canonical_name_unq` would otherwise abort the
  // surrounding write. onConflictDoNothing absorbs the violation and we
  // re-SELECT to find the row the winner inserted.
  const inserted = await (tx as unknown as Db)
    .insert(entities)
    .values({
      teamId: input.teamId,
      type: input.type,
      canonicalName: input.name,
      aliases: input.aliases && input.aliases.length > 0 ? input.aliases : [],
    })
    .onConflictDoNothing()
    .returning({ id: entities.id });
  const row = inserted[0];
  if (row) {
    fireAndForgetEntityEmbed(input.teamId, row.id);
    return row.id;
  }
  // Lost the race: another writer inserted the same
  // (teamId, type, lower(name)). The partial unique key includes `type`, so a
  // same-name/different-type entity would NOT conflict and we'd have already
  // inserted successfully. Re-SELECT with the type filter to be defensive
  // against future index changes — mis-binding a mention to a wrong-type
  // entity must be impossible.
  const winner = await (tx as unknown as Db)
    .select({ id: entities.id })
    .from(entities)
    .where(
      and(
        eq(entities.teamId, input.teamId),
        eq(entities.type, input.type),
        isNull(entities.mergedIntoId),
        isNull(entities.archivedAt),
        sql`lower(${entities.canonicalName}) = ${input.name.toLowerCase()}`,
      ),
    )
    .limit(1);
  const winnerRow = winner[0];
  if (!winnerRow) throw new Error('resolveEntity: insert lost race but no winner found');
  return winnerRow.id;
}

/** Compatibility resolver for callers that explicitly need canonical mutation. */
export async function resolveEntity(
  tx: DbOrTx,
  input: ResolveEntityInput,
  llmDeps: ChatDeps = {},
): Promise<string | null> {
  const chosen = await findEntityMention(tx, input, llmDeps);
  if (!chosen) return input.createIfMissing === true ? insertEntityRow(tx, input) : null;

  if (input.updateAliases !== false) {
    const existingAliases = aliasesArray(chosen.aliases);
    const incoming = [
      ...(input.aliases ?? []),
      // If we matched on a name different from the canonical, keep the variant.
      input.name === chosen.canonicalName ? null : input.name,
    ].filter((s): s is string => typeof s === 'string' && s.length > 0);
    const newAliases = incoming.filter(
      (a) => !existingAliases.some((e) => e.toLowerCase() === a.toLowerCase()),
    );
    if (newAliases.length > 0) {
      const merged = [...existingAliases, ...newAliases];
      await (tx as unknown as Db)
        .update(entities)
        .set({ aliases: merged, updatedAt: new Date() })
        .where(eq(entities.id, chosen.id));
      // Re-embed: alias additions change the entity disambiguation text.
      fireAndForgetEntityEmbed(input.teamId, chosen.id);
    }
  }
  return chosen.id;
}

/**
 * Resolve multiple mentions in order, deduplicating by (lower(name), type).
 * Returns an array parallel to `mentions` mapping each to its entity id.
 */
export async function resolveMentions(
  tx: DbOrTx,
  teamId: string,
  mentions: EntityMention[],
  factStatement: string,
  llmDeps: ChatDeps = {},
  opts: { createIfMissing?: boolean; updateAliases?: boolean } = {},
): Promise<(string | null)[]> {
  return mapMentionIds(mentions, (mention) =>
    resolveEntity(
      tx,
      {
        teamId,
        name: mention.name,
        type: mention.type,
        ...(mention.aliases ? { aliases: mention.aliases } : {}),
        factStatement,
        createIfMissing: opts.createIfMissing === true,
        ...(opts.updateAliases === undefined ? {} : { updateAliases: opts.updateAliases }),
      },
      llmDeps,
    ),
  );
}
