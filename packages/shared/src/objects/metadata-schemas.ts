import { z } from 'zod';

import type { ObjectType } from '#src/objects/types.js';

const optionalTrimmedString = z.string().trim().max(500).nullable().optional();

const companyMetadataPatchSchema = z.object({
  domain: optionalTrimmedString,
  website: optionalTrimmedString,
  relationship: optionalTrimmedString,
});

const personMetadataPatchSchema = z.object({
  role: optionalTrimmedString,
});

const dealMetadataPatchSchema = z.object({
  value: optionalTrimmedString,
  closeDate: optionalTrimmedString,
});

const METADATA_TYPED_KEYS_BY_TYPE = {
  company: ['domain', 'website', 'relationship'] as const,
  person: ['role'] as const,
  deal: ['value', 'closeDate'] as const,
} satisfies Partial<Record<ObjectType, readonly string[]>>;

/** Seed / system keys — never surface or accept from the object Details UI. */
const INTERNAL_METADATA_KEYS = new Set([
  'display_title',
  'display_title_canonical_name',
  'integration_provider',
  'integration_external_id',
  'agent_suggestion_item_id',
  'agent_suggestion_project_for_item_id',
  'fixture_version',
  'seed',
]);

/** Contact belongs on identity facets, not schemaless metadata. */
const CONTACT_METADATA_KEYS = new Set(['email', 'phone']);

const metadataKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, 'Metadata keys must be alphanumeric with underscores');

const metadataValueSchema = z.union([z.string().trim().max(500), z.null()]);

export function isInternalMetadataKey(key: string): boolean {
  return INTERNAL_METADATA_KEYS.has(key) || CONTACT_METADATA_KEYS.has(key);
}

export function typedMetadataKeysFor(type: ObjectType): readonly string[] {
  return type in METADATA_TYPED_KEYS_BY_TYPE
    ? METADATA_TYPED_KEYS_BY_TYPE[type as keyof typeof METADATA_TYPED_KEYS_BY_TYPE]
    : [];
}

export function mergeObjectMetadata(
  existing: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...existing };
  const removals = new Set<string>();
  for (const [key, value] of Object.entries(patch)) {
    if (
      value === null ||
      value === undefined ||
      (typeof value === 'string' && value.trim() === '')
    ) {
      removals.add(key);
      continue;
    }
    next[key] = typeof value === 'string' ? value.trim() : value;
  }
  if (removals.size === 0) return next;
  return Object.fromEntries(Object.entries(next).filter(([key]) => !removals.has(key)));
}

function typedSchemaForObjectType(type: ObjectType): z.ZodType<Record<string, unknown>> | null {
  if (type === 'company') return companyMetadataPatchSchema;
  if (type === 'person') return personMetadataPatchSchema;
  if (type === 'deal') return dealMetadataPatchSchema;
  return null;
}

/**
 * Accepts typed keys for the object type plus arbitrary user keys.
 * Rejects internal/system keys and contact keys that belong on identity facets.
 */
export function parseObjectMetadataPatch(
  type: ObjectType,
  patch: unknown,
): { ok: true; patch: Record<string, unknown> } | { ok: false; error: string } {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return { ok: false, error: 'Invalid metadata patch' };
  }
  const raw = patch as Record<string, unknown>;
  const typedKeys = new Set(typedMetadataKeysFor(type));
  const typedSlice: Record<string, unknown> = {};
  const customSlice: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(raw)) {
    const keyParsed = metadataKeySchema.safeParse(key);
    if (!keyParsed.success) {
      return { ok: false, error: keyParsed.error.issues[0]?.message ?? 'Invalid metadata key' };
    }
    const normalizedKey = keyParsed.data;
    if (isInternalMetadataKey(normalizedKey)) {
      return {
        ok: false,
        error: CONTACT_METADATA_KEYS.has(normalizedKey)
          ? `Use Contact for ${normalizedKey}, not Details`
          : `Metadata key “${normalizedKey}” is reserved`,
      };
    }
    const valueParsed = metadataValueSchema.safeParse(value);
    if (!valueParsed.success) {
      return { ok: false, error: valueParsed.error.issues[0]?.message ?? 'Invalid metadata value' };
    }
    if (typedKeys.has(normalizedKey)) {
      typedSlice[normalizedKey] = valueParsed.data;
    } else {
      customSlice[normalizedKey] = valueParsed.data;
    }
  }

  const typedSchema = typedSchemaForObjectType(type);
  if (Object.keys(typedSlice).length > 0) {
    if (!typedSchema) {
      return { ok: false, error: `Typed metadata is not supported for ${type} objects` };
    }
    const parsed = typedSchema.safeParse(typedSlice);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid metadata patch' };
    }
    for (const [key, value] of Object.entries(parsed.data)) {
      if (value === undefined) continue;
      customSlice[key] = value;
    }
  }

  return { ok: true, patch: customSlice };
}

export function readableMetadataEntries(
  type: ObjectType,
  metadata: Record<string, unknown>,
): { key: string; value: string }[] {
  const keys = [...typedMetadataKeysFor(type)];
  const entries: { key: string; value: string }[] = [];
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim()) {
      entries.push({ key, value: value.trim() });
    }
  }
  for (const [key, value] of Object.entries(metadata)) {
    if (isInternalMetadataKey(key)) continue;
    if (keys.includes(key)) continue;
    if (typeof value === 'string' && value.trim()) {
      entries.push({ key, value: value.trim() });
    }
  }
  return entries;
}
