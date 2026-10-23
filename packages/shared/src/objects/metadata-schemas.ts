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

/** Seed / system / integration keys — never surface or accept from Details UI. */
const INTERNAL_METADATA_KEY_CANONICAL = new Set([
  'displayTitle',
  'displayTitleCanonicalName',
  'integrationProvider',
  'integrationExternalId',
  'agentSuggestionItemId',
  'agentSuggestionProjectForItemId',
  'fixtureVersion',
  'seed',
  'heavy',
  'provider',
  'externalObjectId',
  'targetEntityId',
  'filename',
  'silent',
  'consentConfirmed',
]);

/** Contact belongs on identity facets, not schemaless metadata. */
const CONTACT_METADATA_KEY_CANONICAL = new Set(['email', 'phone']);

const metadataValueSchema = z.union([z.string().trim().max(500), z.null()]);

export function isInternalMetadataKey(key: string): boolean {
  const canonical = slugifyMetadataLabel(key);
  return (
    INTERNAL_METADATA_KEY_CANONICAL.has(canonical) || CONTACT_METADATA_KEY_CANONICAL.has(canonical)
  );
}

export function typedMetadataKeysFor(type: ObjectType): readonly string[] {
  return type in METADATA_TYPED_KEYS_BY_TYPE
    ? METADATA_TYPED_KEYS_BY_TYPE[type as keyof typeof METADATA_TYPED_KEYS_BY_TYPE]
    : [];
}

/** Sentence-case label for a stored metadata key (`lostReason` → `Lost reason`). */
export function humanizeMetadataKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return key;
  const first = words[0] ?? key;
  const rest = words.slice(1);
  return `${first.charAt(0).toUpperCase()}${first.slice(1)}${rest.length > 0 ? ` ${rest.join(' ')}` : ''}`;
}

/** Turn a user-facing field name into a stable camelCase storage key. */
export function slugifyMetadataLabel(label: string): string {
  const parts = label
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .split(/\s+/)
    .map((part) => part.replace(/[^a-zA-Z0-9]/g, ''))
    .filter(Boolean)
    .map((part) => part.toLowerCase());
  if (parts.length === 0) return '';
  const first = parts[0] ?? '';
  const rest = parts.slice(1);
  return `${first}${rest.map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join('')}`;
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
 * Keys may be storage ids or human labels (`Lost reason` → `lostReason`).
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

  for (const [rawKey, value] of Object.entries(raw)) {
    const normalizedKey = slugifyMetadataLabel(rawKey);
    if (!normalizedKey || !/^[a-zA-Z][a-zA-Z0-9]*$/.test(normalizedKey)) {
      return {
        ok: false,
        error: 'Field names must start with a letter and use letters or numbers only',
      };
    }
    if (isInternalMetadataKey(normalizedKey)) {
      return {
        ok: false,
        error: CONTACT_METADATA_KEY_CANONICAL.has(normalizedKey)
          ? `Use Contact for ${humanizeMetadataKey(normalizedKey)}, not Details`
          : `Metadata field “${humanizeMetadataKey(normalizedKey)}” is reserved`,
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
