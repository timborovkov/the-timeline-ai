import { type Db, getDb, users } from '@timeline/db';
import { eq } from 'drizzle-orm';

import type { User } from 'next-auth';
import type { JWT } from 'next-auth/jwt';

/** Shared by proxy and server Auth.js: never renew a revoked JWT's version. */
export async function validateSessionVersion(
  token: JWT,
  user?: User,
  db: Db = getDb(),
): Promise<JWT | null> {
  const userId = user?.id ?? token.sub;
  if (!userId) return null;
  const [row] = await db
    .select({ version: users.sessionVersion })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) return null;
  // Credentials carry the version observed before password verification to close
  // the race between checking the old password and a concurrent reset.
  const version = user ? (user.sessionVersion ?? row.version) : (token.sessionVersion ?? 0);
  if (version !== row.version) return null;
  token.sub = userId;
  token.sessionVersion = version;
  return token;
}
