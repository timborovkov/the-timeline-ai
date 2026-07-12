import { existsSync, readFileSync } from 'node:fs';

import { closeDb, getDb } from '@timeline/db';
import { adminReconcileIntegrationWebhookSubscriptions } from '@timeline/shared/integrations';
import { withTeam } from '@timeline/shared/team-scope';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const args = process.argv.slice(2);
const apply = args.includes('--apply');

function argValue(name: string): string | undefined {
  return args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
}

function argValues(name: string): string[] {
  return args
    .filter((arg) => arg.startsWith(`${name}=`))
    .map((arg) => arg.slice(name.length + 1))
    .filter(Boolean);
}

function loadEnvFile(path: string): void {
  if (!existsSync(path)) throw new Error(`Environment file not found: ${path}`);
  const text = readFileSync(path, 'utf8');
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const equals = trimmed.indexOf('=');
    if (equals === -1) continue;
    const key = trimmed.slice(0, equals).trim();
    const raw = trimmed.slice(equals + 1).trim();
    process.env[key] =
      (raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))
        ? raw.slice(1, -1)
        : raw;
  }
}

function requiredUuid(name: string): string {
  const value = argValue(name);
  if (!value || !UUID_RE.test(value)) throw new Error(`${name}=<uuid> is required`);
  return value;
}

async function discoverHelperBoardIds(accessToken: string, boardIds: string[]): Promise<string[]> {
  const helperIds: string[] = [];
  for (let offset = 0; offset < boardIds.length; offset += 100) {
    const ids = boardIds.slice(offset, offset + 100);
    const response = await fetch('https://api.monday.com/v2', {
      method: 'POST',
      headers: {
        authorization: accessToken,
        'api-version': '2026-04',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        query: `query TimelineMondayHelperRepair($ids: [ID!]) {
          boards(ids: $ids) { id type }
        }`,
        variables: { ids },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await response.json()) as {
      data?: { boards?: { id: string; type?: string | null }[] };
      errors?: { message?: string }[];
    };
    if (!response.ok || body.errors?.length) {
      throw new Error(`Monday board classification failed (${String(response.status)})`);
    }
    for (const board of body.data?.boards ?? []) {
      if (board.type === 'sub_items_board') helperIds.push(String(board.id));
    }
  }
  return helperIds;
}

const envFile = argValue('--env-file') ?? '.env';
loadEnvFile(envFile);
const teamId = requiredUuid('--team-id');
const userId = requiredUuid('--user-id');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

const db = getDb();
const scope = withTeam(db, teamId, userId);

try {
  await scope.requireMembership('admin');
  const shares = await scope.integrations.listTeamResourceShares();
  const mondayShares = shares.filter(
    ({ connection, share }) =>
      connection.provider === 'monday' && share.resourceKind === 'monday.board' && !share.revokedAt,
  );
  const connectionIds = [...new Set(mondayShares.map(({ connection }) => connection.id))];
  const discoveredHelperIds: string[] = [];
  const unverifiedConnectionIds: string[] = [];
  for (const connectionId of connectionIds) {
    const tokens = await scope.integrations.getProviderConnectionTokens(connectionId);
    const accessToken = typeof tokens?.access_token === 'string' ? tokens.access_token : null;
    if (!accessToken) {
      unverifiedConnectionIds.push(connectionId);
      continue;
    }
    const boardIds = mondayShares
      .filter(({ connection }) => connection.id === connectionId)
      .map(({ share }) => share.externalId);
    discoveredHelperIds.push(...(await discoverHelperBoardIds(accessToken, boardIds)));
  }
  const helperBoardIds = [...new Set([...discoveredHelperIds, ...argValues('--helper-board-id')])];
  if (apply && unverifiedConnectionIds.length > 0 && !args.includes('--allow-unverified')) {
    throw new Error(
      'Some Monday connections are not owned by --user-id and could not be classified; rerun as the connection owner or pass --allow-unverified after reviewing the dry-run',
    );
  }
  const report = await scope.integrations.repairMondayHelperResources({
    helperBoardIds,
    apply,
  });
  const output: Record<string, unknown> = {
    mode: apply ? 'apply' : 'dry-run',
    helperBoardIds,
    unverifiedConnectionIds,
    ...report,
  };

  if (apply && report.integrationIds.length > 0) {
    const queue = await import('@timeline/shared/queue');
    const webhookResults: { integrationId: string; status: 'ok' | 'failed'; error?: string }[] = [];
    for (const integrationId of report.integrationIds) {
      await queue.enqueueIntegrationSyncJob({
        kind: 'backfill',
        integrationId,
        teamId,
        triggeredBy: userId,
      });
      try {
        await adminReconcileIntegrationWebhookSubscriptions(db, integrationId);
        await scope.integrations.resolveConnectionAttention({
          integrationId,
          categories: ['webhook_degraded'],
        });
        webhookResults.push({ integrationId, status: 'ok' });
      } catch (error) {
        webhookResults.push({
          integrationId,
          status: 'failed',
          error: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
        });
      }
    }
    output.backfillsQueued = report.integrationIds.length;
    output.webhookReconciliation = webhookResults;
  }

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
} finally {
  await closeDb();
}
