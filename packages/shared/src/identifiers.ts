/** Matches an entire hexadecimal UUID, including the nil UUID. */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export { NIL_UUID } from '@timeline/db/contracts/identifiers';

const UUID_V1_TO_V5_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuidV1ToV5(value: unknown): value is string {
  return typeof value === 'string' && UUID_V1_TO_V5_RE.test(value);
}
