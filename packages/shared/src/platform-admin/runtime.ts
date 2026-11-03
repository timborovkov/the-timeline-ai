import { AsyncLocalStorage } from 'node:async_hooks';

import {
  getDb,
  auditLog,
  documentVersions,
  rawEvents,
  platformAdminAudit,
  platformImpersonationSessions,
  teamBillingAccounts,
  users,
  type Db,
} from '@timeline/db';
import { and, eq } from 'drizzle-orm';

import {
  PlatformAccessError,
  recordPlatformAudit,
  resolveImpersonation,
} from '#src/platform-admin/index.js';

export interface OperatorContext {
  actorUserId: string;
  actorEmail: string;
  effectiveUserId: string;
  teamId: string;
  sessionId: string;
  readOnly: boolean;
}
const contextStorage = new AsyncLocalStorage<OperatorContext>();
const admissionStorage = new AsyncLocalStorage<{ teamId: string; userId: string }>();
const readAuditStorage = new AsyncLocalStorage<boolean>();
const maintenanceStorage = new AsyncLocalStorage<boolean>();
let webResolver: (() => Promise<OperatorContext | null>) | undefined;
export function registerOperatorContextResolver(resolver: () => Promise<OperatorContext | null>) {
  webResolver = resolver;
}
export async function operatorContext(): Promise<OperatorContext | null> {
  return contextStorage.getStore() ?? (webResolver ? await webResolver() : null);
}
export async function assertActivePrincipal(db: Db, teamId: string, userId?: string) {
  const [account] = await db
    .select({ state: teamBillingAccounts.securityState })
    .from(teamBillingAccounts)
    .where(eq(teamBillingAccounts.teamId, teamId));
  if (account?.state === 'suspended' || account?.state === 'terminated')
    throw new PlatformAccessError('Workspace is suspended');
  if (userId) {
    const [user] = await db
      .select({ suspendedAt: users.suspendedAt })
      .from(users)
      .where(eq(users.id, userId));
    if (user?.suspendedAt) throw new PlatformAccessError('Account is suspended');
  }
}
export async function guardTeamAccess(db: Db, teamId: string, userId: string, system = false) {
  const context = await operatorContext();
  if (context) {
    if (
      context.teamId !== teamId ||
      (context.effectiveUserId !== userId && !(system && contextStorage.getStore()))
    )
      throw new PlatformAccessError('Impersonation is restricted to the selected member and team');
    // Read-only suspended inspection is gated separately at the operation boundary.
    if (context.readOnly) return;
  }
  if (!context && maintenanceStorage.getStore()) return;
  const admitted = admissionStorage.getStore();
  if (admitted?.teamId === teamId && admitted.userId === userId) return;
  await assertActivePrincipal(db, teamId, userId);
}
const READ_OPERATION =
  /^(get|list|read|search|count|find|resolve|is|has|require|can|preview|summarizeVisibility)/;
// Read helpers without a conventional read prefix must be reviewed by full scope path.
const ADDITIONAL_READ_OPERATIONS = new Set(['timeline.team', 'objects.unreadNotificationCount']);
const guardedScopes = new WeakSet();
const SKIP_NESTED_SCOPE_KEYS = new Set(['postCommitDb', 'postCommitEffects', 'teamId', 'userId']);

function isPlainScopeRecord(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isDatabaseHandle(value: object): boolean {
  const record = value as { select?: unknown; transaction?: unknown };
  return typeof record.select === 'function' && typeof record.transaction === 'function';
}

/**
 * Wrap enumerable own methods in place so later `spyOn` and closed-over nested
 * scopes (suggestions → objects) observe the same functions. A Proxy wrapper
 * would intercept callers of the returned object, but not `vi.spyOn` patches
 * on the original nested scope. Never wrap the Drizzle handle or other class
 * instances: replacing `db.select` with a guard that itself queries `db`
 * recurses until the process hangs.
 */
export function guardOperatorScope<T extends object>(
  db: Db,
  teamId: string,
  userId: string,
  scope: T,
  prefix = '',
  system = false,
): T {
  if (guardedScopes.has(scope)) return scope;
  guardedScopes.add(scope);
  for (const key of Object.keys(scope)) {
    if (SKIP_NESTED_SCOPE_KEYS.has(key)) continue;
    const value = (scope as Record<string, unknown>)[key];
    const operation = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (isPlainScopeRecord(value) && !isDatabaseHandle(value))
        guardOperatorScope(db, teamId, userId, value, operation, system);
      continue;
    }
    if (typeof value !== 'function') continue;
    (scope as Record<string, unknown>)[key] = async (...args: unknown[]) => {
      const context = await operatorContext();
      if (context) {
        await guardTeamAccess(db, teamId, userId, system);
        if (
          context.readOnly &&
          !READ_OPERATION.test(key) &&
          !ADDITIONAL_READ_OPERATIONS.has(operation)
        )
          throw new PlatformAccessError('Suspended inspection is read-only');
        if (/^(billingOperator|mcpOAuth)\./.test(operation))
          throw new PlatformAccessError('Use your administrator identity for account management');
        await recordPlatformAudit(db, {
          actorUserId: context.actorUserId,
          effectiveUserId: context.effectiveUserId,
          teamId,
          sessionId: context.sessionId,
          action: `impersonation.${operation}`,
        });
      }
      // Only internal system scopes can reconcile billing or prune expired data while
      // suspended. Never grant a browser or an impersonated job this exception.
      if (
        !context &&
        system &&
        (operation.startsWith('billing.') ||
          operation.startsWith('billingOperator.') ||
          operation === 'mcpOAuth.pruneExpiredCredentials' ||
          operation === 'pins.pruneDeletedTimelineMomentPins')
      )
        return maintenanceStorage.run(true, () => Reflect.apply(value, scope, args) as unknown);
      // Nested helpers may run inside a transaction while closing over the outer
      // connection. Reuse this operation's admission instead of querying that
      // connection again (which deadlocks a single-connection transaction).
      await guardTeamAccess(db, teamId, userId, system);
      return admissionStorage.run(
        { teamId, userId },
        () => Reflect.apply(value, scope, args) as unknown,
      );
    };
  }
  return scope;
}
export async function tagOperatorJob<T>(data: T): Promise<T> {
  const context = await operatorContext();
  if (!context) return data;
  if (context.readOnly) throw new PlatformAccessError('Suspended inspection cannot schedule work');
  if (!data || typeof data !== 'object' || !('teamId' in data) || data.teamId !== context.teamId)
    throw new PlatformAccessError('Job must belong to the impersonated team');
  if ('userId' in data && data.userId && data.userId !== context.effectiveUserId)
    throw new PlatformAccessError('Job must belong to the impersonated user');
  return { ...data, platformOperatorSessionId: context.sessionId };
}
export async function runGuardedJob<T>(
  data: unknown,
  callback: () => Promise<T>,
  db: Db = getDb(),
): Promise<T> {
  if (!data || typeof data !== 'object') return callback();
  const payload = { ...data } as {
    teamId?: string;
    userId?: string;
    requestedByUserId?: string;
    documentVersionId?: string;
    platformOperatorSessionId?: string;
  };
  // Recovery may reconstruct an extraction job without queue attribution. Resolve
  // its immutable upload event before choosing the effective execution identity.
  if (payload.documentVersionId && payload.teamId) {
    const [version] = await db
      .select({ metadata: rawEvents.sourceMetadata, userId: documentVersions.uploadedByUserId })
      .from(documentVersions)
      .leftJoin(rawEvents, eq(rawEvents.id, documentVersions.sourceEventId))
      .where(
        and(
          eq(documentVersions.id, payload.documentVersionId),
          eq(documentVersions.teamId, payload.teamId),
        ),
      );
    const durableSession = (version?.metadata as Record<string, unknown> | null)
      ?.platformOperatorSessionId;
    if (typeof durableSession === 'string') {
      if (payload.platformOperatorSessionId && payload.platformOperatorSessionId !== durableSession)
        throw new PlatformAccessError('Document job attribution does not match its upload');
      payload.platformOperatorSessionId = durableSession;
    }
    if (!payload.userId && version?.userId) payload.userId = version.userId;
  }
  const initiatingUser = payload.userId ?? payload.requestedByUserId;
  if (payload.teamId && /^[0-9a-f-]{36}$/i.test(payload.teamId))
    await assertActivePrincipal(db, payload.teamId, initiatingUser);
  if (!payload.platformOperatorSessionId) return callback();
  const [session] = await db
    .select()
    .from(platformImpersonationSessions)
    .where(eq(platformImpersonationSessions.id, payload.platformOperatorSessionId));
  if (
    !session ||
    session.endedAt ||
    session.expiresAt <= new Date() ||
    session.teamId !== payload.teamId ||
    (initiatingUser && initiatingUser !== session.effectiveUserId)
  )
    throw new PlatformAccessError('Impersonated job authorization expired');
  const [actor] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, session.actorUserId));
  if (!actor) throw new PlatformAccessError('Administrator no longer exists');
  // Resolve by a stored hash without disclosing or retaining the browser token.
  const resolved = await resolveImpersonation(
    db,
    { userId: session.actorUserId, email: actor.email },
    session.tokenHash,
    true,
  );
  if (resolved.readOnly) throw new PlatformAccessError('Suspended inspection cannot execute work');
  const context: OperatorContext = {
    actorUserId: session.actorUserId,
    actorEmail: actor.email,
    effectiveUserId: session.effectiveUserId,
    teamId: session.teamId,
    sessionId: session.id,
    readOnly: false,
  };
  await recordPlatformAudit(db, {
    actorUserId: context.actorUserId,
    effectiveUserId: context.effectiveUserId,
    teamId: context.teamId,
    sessionId: context.sessionId,
    action: 'impersonation.job',
  });
  return contextStorage.run(context, callback);
}

/** Only the two sensitive detail-read audit appends may write during inspection. */
export async function recordScopedReadAudit(
  db: Db,
  input: Omit<typeof auditLog.$inferInsert, 'action'> & {
    action: 'document.detail_read' | 'event.detail_read';
  },
): Promise<void> {
  if (!['document.detail_read', 'event.detail_read'].includes(input.action))
    throw new PlatformAccessError('Unsupported read audit');
  const context = await operatorContext();
  if (context && (input.teamId !== context.teamId || input.actorUserId !== context.effectiveUserId))
    throw new PlatformAccessError('Read audit must match the impersonated identity');
  await readAuditStorage.run(true, async () => {
    await db.insert(auditLog).values(input);
  });
}

/** Guard writes even when a read helper initializes defaults or uses direct Drizzle access. */
export function operatorDatabase<T extends Db>(database: T): T {
  async function assertWritable() {
    if ((await operatorContext())?.readOnly)
      throw new PlatformAccessError('Suspended inspection is read-only');
  }
  function guardedBuilder<TBuilder extends object>(builder: TBuilder): TBuilder {
    return new Proxy(builder, {
      get(target, key, receiver) {
        const value: unknown = Reflect.get(target, key, receiver);
        if (typeof value !== 'function') return value;
        if (key === 'then')
          return (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
            assertWritable().then(
              () => Reflect.apply(value, target, [resolve, reject]) as unknown,
              reject,
            );
        if (key === 'execute')
          return async (...args: unknown[]) => {
            await assertWritable();
            return Reflect.apply(value, target, args) as unknown;
          };
        return (...args: unknown[]) => {
          const result: unknown = Reflect.apply(value, target, args);
          return result && typeof result === 'object' ? guardedBuilder(result) : result;
        };
      },
    });
  }
  return new Proxy(database, {
    get(target, key, receiver) {
      const value: unknown = Reflect.get(target, key, receiver);
      if (typeof value !== 'function') return value;
      if (key === 'insert' || key === 'update' || key === 'delete')
        return (...args: unknown[]) => {
          const builder = Reflect.apply(value, target, args) as object;
          return key === 'insert' &&
            (args[0] === platformAdminAudit ||
              (args[0] === auditLog && readAuditStorage.getStore()))
            ? builder
            : guardedBuilder(builder);
        };
      if (key === 'execute')
        return async (...args: unknown[]) => {
          await assertWritable();
          return Reflect.apply(value, target, args) as unknown;
        };
      if (key === 'transaction')
        return (callback: (tx: Db) => unknown, ...args: unknown[]) =>
          Reflect.apply(value, target, [
            (tx: Db) => callback(operatorDatabase(tx)),
            ...args,
          ]) as unknown;
      return value.bind(target) as unknown;
    },
  });
}

export async function principalIsActive(db: Db, teamId: string, userId?: string): Promise<boolean> {
  try {
    await assertActivePrincipal(db, teamId, userId);
    return true;
  } catch (error) {
    if (error instanceof PlatformAccessError) return false;
    throw error;
  }
}
