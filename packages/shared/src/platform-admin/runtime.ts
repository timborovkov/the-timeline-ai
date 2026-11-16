import { AsyncLocalStorage } from 'node:async_hooks';

import {
  getDb,
  auditLog,
  documentVersions,
  rawEvents,
  websiteRuns,
  platformAdminAudit,
  platformImpersonationSessions,
  teamBillingAccounts,
  users,
  teams,
  type Db,
} from '@timeline/db';
import { and, eq, sql, type SQLWrapper } from 'drizzle-orm';

import {
  PlatformAccessError,
  recordPlatformAudit,
  resolveImpersonation,
} from '#src/platform-admin/index.js';

import type { OperatorCapability, OperatorScopePolicy } from '#src/platform-admin/capabilities.js';

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
export function isInactiveWorkspaceSecurityState(state: string | null | undefined): boolean {
  return state === 'suspended' || state === 'terminated';
}

/** Shared admission predicate for global scans; apply before pagination/limits. */
export function activeWorkspaceCondition(teamId: SQLWrapper) {
  return sql`exists (
    select 1 from teams as active_workspace
    where active_workspace.id = ${teamId}
      and active_workspace.disabled_at is null
      and active_workspace.deletion_started_at is null
      and active_workspace.deleted_at is null
      and not exists (
        select 1 from team_billing_accounts as inactive_account
        where inactive_account.team_id = active_workspace.id
          and inactive_account.security_state in ('suspended', 'terminated')
      )
  )`;
}

export class InactiveWorkspaceError extends PlatformAccessError {}

/** Recognize only lifecycle denials, including a Drizzle-wrapped trigger error. */
export function isInactiveWorkspaceError(error: unknown): boolean {
  const seen = new Set<unknown>();
  while (error && typeof error === 'object' && !seen.has(error)) {
    seen.add(error);
    if (error instanceof InactiveWorkspaceError) return true;
    if (
      'code' in error &&
      error.code === '42501' &&
      'message' in error &&
      error.message === 'Workspace is disabled'
    )
      return true;
    error = 'cause' in error ? error.cause : undefined;
  }
  return false;
}

export async function assertActivePrincipal(db: Db, teamId: string, userId?: string) {
  const [team] = await db
    .select({
      disabledAt: teams.disabledAt,
      deleting: teams.deletionStartedAt,
      deletedAt: teams.deletedAt,
    })
    .from(teams)
    .where(eq(teams.id, teamId));
  if (!team || team.disabledAt || team.deleting || team.deletedAt)
    throw new InactiveWorkspaceError('Workspace is suspended (disabled)');
  const [account] = await db
    .select({ state: teamBillingAccounts.securityState })
    .from(teamBillingAccounts)
    .where(eq(teamBillingAccounts.teamId, teamId));
  if (isInactiveWorkspaceSecurityState(account?.state))
    throw new InactiveWorkspaceError('Workspace is suspended');
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
    if (context.readOnly) {
      const [team] = await db
        .select({ deleting: teams.deletionStartedAt })
        .from(teams)
        .where(eq(teams.id, teamId));
      if (!team || team.deleting) throw new PlatformAccessError('Workspace deletion has started');
      return;
    }
  }
  if (!context && maintenanceStorage.getStore()) return;
  const admitted = admissionStorage.getStore();
  if (admitted?.teamId === teamId && admitted.userId === userId) return;
  // Nested helpers may close over a transaction client. Skip only after this
  // principal was admitted into AsyncLocalStorage — a Transaction constructor
  // name is not authorization. Querying an unadmitted tx client is required so
  // first scoped ops like withTeam(tx) inside db.transaction still check
  // suspension. Admitted nested calls reuse this store instead of querying
  // again (which deadlocks a single-connection transaction).
  await assertActivePrincipal(db, teamId, userId);
}
const WRAPPED_OPERATOR_METHOD = Symbol('timeline.guardOperatorWrapped');
const wrappedOperatorScopes = new WeakSet();
const SKIP_NESTED_SCOPE_KEYS = new Set(['postCommitDb', 'postCommitEffects', 'teamId', 'userId']);

function isPlainScopeRecord(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isDatabaseHandle(value: object): boolean {
  const record = value as { select?: unknown; transaction?: unknown };
  return typeof record.select === 'function' && typeof record.transaction === 'function';
}

export function guardOperatorScope<T extends object>(
  db: Db,
  teamId: string,
  userId: string,
  scope: T,
  capabilities: OperatorScopePolicy<NoInfer<T>>,
  prefix = '',
  system = false,
): T {
  validateOperatorCapabilities(scope, capabilities, prefix);
  return wrapOperatorScope(db, teamId, userId, scope, capabilities, prefix, system);
}

function validateOperatorCapabilities(
  scope: object,
  capabilities: Readonly<Record<string, OperatorCapability>>,
  prefix: string,
): void {
  for (const key of Object.keys(scope)) {
    if (SKIP_NESTED_SCOPE_KEYS.has(key)) continue;
    const value: unknown = Reflect.get(scope, key);
    const operation = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'function' && !capabilities[operation]) {
      throw new PlatformAccessError(`Missing operator capability for ${operation}`);
    }
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      isPlainScopeRecord(value) &&
      !isDatabaseHandle(value)
    ) {
      validateOperatorCapabilities(value, capabilities, operation);
    }
  }
}

function wrapOperatorScope<T extends object>(
  db: Db,
  teamId: string,
  userId: string,
  scope: T,
  capabilities: Readonly<Record<string, OperatorCapability>>,
  prefix: string,
  system: boolean,
): T {
  // Wrap own methods in place and return the same plain object. A Proxy here
  // would hide replacements from Bun's spyOn and from helpers that close over
  // the original nested namespace. Never wrap Drizzle handles or other class
  // instances: replacing `db.select` with a guard that itself queries `db`
  // recurses until the process hangs.
  if (wrappedOperatorScopes.has(scope)) return scope;
  wrappedOperatorScopes.add(scope);
  for (const key of Object.keys(scope)) {
    if (SKIP_NESTED_SCOPE_KEYS.has(key)) continue;
    const value: unknown = Reflect.get(scope, key);
    const operation = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (isPlainScopeRecord(value) && !isDatabaseHandle(value))
        wrapOperatorScope(db, teamId, userId, value, capabilities, operation, system);
      continue;
    }
    if (typeof value !== 'function') continue;
    if (Reflect.get(value, WRAPPED_OPERATOR_METHOD) === true) continue;
    const capability = capabilities[operation];
    if (!capability) throw new PlatformAccessError(`Missing operator capability for ${operation}`);
    const original = value;
    Reflect.set(
      scope,
      key,
      Object.assign(
        async (...args: unknown[]) => {
          const context = await operatorContext();
          if (context) {
            await guardTeamAccess(db, teamId, userId, system);
            if (context.readOnly && !capability.readOnly)
              throw new PlatformAccessError('Suspended inspection is read-only');
            if (!capability.impersonation)
              throw new PlatformAccessError(
                'Use your administrator identity for account management',
              );
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
          if (!context && system && capability.maintenance)
            return maintenanceStorage.run(
              true,
              () => Reflect.apply(original, scope, args) as unknown,
            );
          // Nested helpers may run inside a transaction while closing over the outer
          // connection. Reuse this operation's admission instead of querying that
          // connection again (which deadlocks a single-connection transaction).
          await guardTeamAccess(db, teamId, userId, system);
          return admissionStorage.run(
            { teamId, userId },
            () => Reflect.apply(original, scope, args) as unknown,
          );
        },
        { [WRAPPED_OPERATOR_METHOD]: true as const },
      ),
    );
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
    scanId?: string;
    platformOperatorSessionId?: string;
  };
  if (payload.teamId && /^[0-9a-f-]{36}$/i.test(payload.teamId))
    await assertActivePrincipal(db, payload.teamId);
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
  // Website admission outlives queue submission. Recover the original session even
  // when the durable outbox or an idempotent client reconstructs an untagged job.
  if (payload.scanId && payload.teamId) {
    const [run] = await db
      .select({
        sessionId: websiteRuns.platformOperatorSessionId,
        requestedBy: websiteRuns.requestedBy,
      })
      .from(websiteRuns)
      .where(and(eq(websiteRuns.teamId, payload.teamId), eq(websiteRuns.id, payload.scanId)));
    if (run) {
      if (
        (payload.userId && payload.userId !== run.requestedBy) ||
        (payload.requestedByUserId && payload.requestedByUserId !== run.requestedBy)
      )
        throw new PlatformAccessError('Website job attribution does not match its admission');
      if (run.sessionId) {
        if (
          payload.platformOperatorSessionId &&
          payload.platformOperatorSessionId !== run.sessionId
        )
          throw new PlatformAccessError('Website job attribution does not match its admission');
        payload.platformOperatorSessionId = run.sessionId;
      }
      payload.userId = run.requestedBy;
    }
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
