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

const METADATA_PATCH_KEYS_BY_TYPE = {
  company: ['domain', 'website', 'relationship'] as const,
  person: ['role'] as const,
  deal: ['value', 'closeDate'] as const,
} satisfies Partial<Record<ObjectType, readonly string[]>>;

const INTERNAL_METADATA_KEYS = new Set([
  'display_title',
  'display_title_canonical_name',
  'integration_provider',
  'integration_external_id',
  'agent_suggestion_item_id',
  'agent_suggestion_project_for_item_id',
]);

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

function schemaForObjectType(type: ObjectType): z.ZodType<Record<string, unknown>> | null {
  if (type === 'company') return companyMetadataPatchSchema;
  if (type === 'person') return personMetadataPatchSchema;
  if (type === 'deal') return dealMetadataPatchSchema;
  return null;
}

export function parseObjectMetadataPatch(
  type: ObjectType,
  patch: unknown,
): { ok: true; patch: Record<string, unknown> } | { ok: false; error: string } {
  const schema = schemaForObjectType(type);
  if (!schema) {
    return { ok: false, error: `Metadata editing is not supported for ${type} objects` };
  }
  const parsed = schema.safeParse(patch);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid metadata patch' };
  }
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed.data)) {
    if (value === undefined) continue;
    normalized[key] = value;
  }
  return { ok: true, patch: normalized };
}

export function readableMetadataEntries(
  type: ObjectType,
  metadata: Record<string, unknown>,
): { key: string; value: string }[] {
  const keys =
    type in METADATA_PATCH_KEYS_BY_TYPE
      ? [...METADATA_PATCH_KEYS_BY_TYPE[type as keyof typeof METADATA_PATCH_KEYS_BY_TYPE]]
      : [];
  const entries: { key: string; value: string }[] = [];
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim()) {
      entries.push({ key, value: value.trim() });
    }
  }
  for (const [key, value] of Object.entries(metadata)) {
    if (INTERNAL_METADATA_KEYS.has(key)) continue;
    if (keys.includes(key as (typeof keys)[number])) continue;
    if (typeof value === 'string' && value.trim()) {
      entries.push({ key, value: value.trim() });
    }
  }
  return entries;
}
