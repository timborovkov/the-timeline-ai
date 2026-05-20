import { type Db, entities } from '@timeline/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { chatStructured, type ChatDeps } from '../llm/chat';

import type { EntityMention, ExtractedEntityType } from './schema';

/** A Drizzle transaction or Db — both expose the query surface we need. */
export type DbOrTx = Parameters<Db['transaction']>[0] extends (tx: infer T) => unknown ? T : Db;

export interface ResolveEntityInput {
  teamId: string;
  name: string;
  type: ExtractedEntityType;
  aliases?: string[];
  /** Fact statement used as disambiguation context when ambiguous. */
  factStatement?: string;
}

interface EntityRow {
  id: string;
  type: ExtractedEntityType;
  canonicalName: string;
  aliases: unknown;
}

function aliasesArray(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === 'string');
  return [];
}

const disambiguationSchema = z.object({
  // Index into the candidates array (0-based) or -1 for "none, create new".
  choice: z.number().int(),
});

async function disambiguate(
  candidates: EntityRow[],
  input: ResolveEntityInput,
  llmDeps: ChatDeps,
): Promise<EntityRow | null> {
  const listing = candidates
    .map(
      (c, i) =>
        `${i}: [${c.type}] ${c.canonicalName} (aliases: ${aliasesArray(c.aliases).join(', ') || 'none'})`,
    )
    .join('\n');
  const prompt = `Mention: "${input.name}" (type=${input.type}) in fact: "${input.factStatement ?? ''}".
Existing candidates:
${listing}

Pick the candidate that refers to the same real-world entity. Return its index, or -1 if none match and a new entity should be created.`;
  const { object } = await chatStructured(
    {
      schema: disambiguationSchema,
      prompt,
      system:
        'You disambiguate entity mentions. Reply with the chosen candidate index, or -1 to create a new entity.',
    },
    llmDeps,
  );
  if (object.choice < 0 || object.choice >= candidates.length) return null;
  return candidates[object.choice] ?? null;
}

/**
 * Resolve an entity mention to a stable entity id, creating one if no match.
 *
 * Strategy (deterministic-first, LLM only as tiebreaker):
 *   1. Exact case-insensitive match on canonical_name OR membership in aliases.
 *   2. Prefer same-type candidates; if zero same-type but cross-type matches exist,
 *      use them (logged) — different types with the same name are usually the
 *      same real-world thing tagged differently by different prompts.
 *   3. Zero matches → insert new entity.
 *   4. One match → return; merge any new aliases into the row.
 *   5. Multi-match → ask the LLM to pick one, or create new.
 *
 * Limitation (Phase 4): no fuzzy / embedding-based dedup. "Apple" and
 * "Apple Inc" will land as two entities unless one of them carries the other
 * as an alias. Admin merge UI handles cleanup. Phase 5+ may add embedding
 * similarity once vectors exist.
 */
export async function resolveEntity(
  tx: DbOrTx,
  input: ResolveEntityInput,
  llmDeps: ChatDeps = {},
): Promise<string> {
  const lowerName = input.name.toLowerCase();
  // jsonb_path_ops requires the @> operator; we cast a single-element array.
  const aliasMatch = sql`${entities.aliases} @> ${JSON.stringify([input.name])}::jsonb`;
  const lowerCanonical = sql`lower(${entities.canonicalName})`;
  const matches = (await (tx as unknown as Db)
    .select({
      id: entities.id,
      type: entities.type,
      canonicalName: entities.canonicalName,
      aliases: entities.aliases,
    })
    .from(entities)
    .where(
      and(
        eq(entities.teamId, input.teamId),
        isNull(entities.mergedIntoId),
        sql`(${lowerCanonical} = ${lowerName} OR ${aliasMatch})`,
      ),
    )) as EntityRow[];

  const sameType = matches.filter((m) => m.type === input.type);
  const candidates = sameType.length > 0 ? sameType : matches;

  if (candidates.length === 0) {
    const inserted = await (tx as unknown as Db)
      .insert(entities)
      .values({
        teamId: input.teamId,
        type: input.type,
        canonicalName: input.name,
        aliases: input.aliases && input.aliases.length > 0 ? input.aliases : [],
      })
      .returning({ id: entities.id });
    const row = inserted[0];
    if (!row) throw new Error('Failed to insert entity');
    return row.id;
  }

  let chosen: EntityRow | null;
  if (candidates.length === 1) {
    chosen = candidates[0] ?? null;
  } else {
    chosen = await disambiguate(candidates, input, llmDeps);
    if (!chosen) {
      // LLM said "none of these" — create a new entity.
      const inserted = await (tx as unknown as Db)
        .insert(entities)
        .values({
          teamId: input.teamId,
          type: input.type,
          canonicalName: input.name,
          aliases: input.aliases ?? [],
        })
        .returning({ id: entities.id });
      const row = inserted[0];
      if (!row) throw new Error('Failed to insert entity');
      return row.id;
    }
  }
  if (!chosen) throw new Error('resolveEntity: no candidate selected');

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
): Promise<string[]> {
  const cache = new Map<string, string>();
  const out: string[] = [];
  for (const m of mentions) {
    const key = `${m.type}:${m.name.toLowerCase()}`;
    let id = cache.get(key);
    if (!id) {
      id = await resolveEntity(
        tx,
        {
          teamId,
          name: m.name,
          type: m.type,
          ...(m.aliases ? { aliases: m.aliases } : {}),
          factStatement,
        },
        llmDeps,
      );
      cache.set(key, id);
    }
    out.push(id);
  }
  return out;
}
