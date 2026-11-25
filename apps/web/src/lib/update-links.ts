import { safeSameOriginPath } from '@/lib/safe-redirect';

const updateDestination =
  /^\/app\/(?:digests|timeline|calendar|tasks|objects|approvals|(?:objects|boards)\/[a-f0-9-]{36})(?:[?#]|$)/i;

export function updateDestinationPath(value: string | undefined): string | null {
  const path = safeSameOriginPath(value, '');
  return updateDestination.test(path) ? path : null;
}
