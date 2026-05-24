import type { objects } from '@timeline/shared';

/**
 * Client-safe mirror of `objects.OBJECT_TYPES` (which is itself derived
 * from the drizzle `entity_type` enum). Lives here so client components
 * (board-create-form, new-object-form, etc.) can render dropdowns and
 * narrow types without importing `@timeline/shared` at runtime —
 * importing that module would pull drizzle-orm + postgres-js into the
 * browser bundle for the sake of a 13-element string array.
 *
 * The `_assertExhaustive` check below uses TypeScript-only types
 * (erased at build) to fail compilation if this list and the drizzle
 * enum drift apart in either direction:
 *
 *   - new enum value added in DB but missing here → first check fails
 *   - value removed from DB but still here → second check fails
 *
 * So this stays in lockstep with the schema with zero runtime cost.
 */
export const OBJECT_TYPES = [
  'person',
  'company',
  'project',
  'topic',
  'other',
  'deal',
  'vendor',
  'incident',
  'document',
  'decision',
  'hiring_loop',
  'task',
  'follow_up',
] as const;

type ObjectType = (typeof OBJECT_TYPES)[number];

// Compile-time exhaustiveness: both directions of the subset check must
// hold, otherwise TS reports the assignment as an error.
type _Includes<A, B> = A extends B ? true : false;
type _Bidirectional =
  _Includes<ObjectType, objects.ObjectType> extends true
    ? _Includes<objects.ObjectType, ObjectType> extends true
      ? true
      : false
    : false;
const _assertExhaustive: _Bidirectional = true;
void _assertExhaustive;
