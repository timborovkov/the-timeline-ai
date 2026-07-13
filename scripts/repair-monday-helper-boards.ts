import { existsSync, readFileSync } from 'node:fs';

import { closeDb, getDb } from '@timeline/db';
import {
  adminReconcileIntegrationWebhookSubscriptions,
  classifyMondayBoardResponse,
  runMondayHelperRepairFollowups,
} from '@timeline/shared/integrations';
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

async function discoverHelperBoardIds(
  accessToken: string,
  boardIds: string[],
): Promise<{ helperBoardIds: string[]; missingBoardIds: string[] }> {
  const helperIds: string[] = [];
  const missingBoardIds: string[] = [];
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
    const classification = classifyMondayBoardResponse(ids, body.data?.boards ?? []);
    helperIds.push(...classification.helperBoardIds);
    missingBoardIds.push(...classification.missingBoardIds);
  }
  return { helperBoardIds: helperIds, missingBoardIds };
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
  const sources = await scope.integrations.listMondayHelperRepairSources();
  const discoveredHelperIds: string[] = [];
  const unverifiedSources: {
    credentialKind: string;
    credentialId: string;
    missingBoardIds?: string[];
  }[] = [];
  for (const source of sources) {
    const tokens =
      source.credentialKind === 'provider_connection'
        ? await scope.integrations.getProviderConnectionTokens(source.credentialId)
        : await scope.integrations.getIntegrationTokens(source.credentialId);
    const accessToken = typeof tokens?.access_token === 'string' ? tokens.access_token : null;
    if (!accessToken) {
      unverifiedSources.push({
        credentialKind: source.credentialKind,
        credentialId: source.credentialId,
      });
      continue;
    }
    const discovery = await discoverHelperBoardIds(accessToken, source.boardIds);
    discoveredHelperIds.push(...discovery.helperBoardIds);
    if (discovery.missingBoardIds.length > 0) {
      unverifiedSources.push({
        credentialKind: source.credentialKind,
        credentialId: source.credentialId,
        missingBoardIds: discovery.missingBoardIds,
      });
    }
  }
  const helperBoardIds = [...new Set([...discoveredHelperIds, ...argValues('--helper-board-id')])];
  if (apply && unverifiedSources.length > 0 && !args.includes('--allow-unverified')) {
    throw new Error(
      'Some Monday credential sources could not be classified; rerun as the connection owner, reconnect the direct integration, or pass --allow-unverified after reviewing the dry-run',
    );
  }
  const report = await scope.integrations.repairMondayHelperResources({
    helperBoardIds,
    apply,
  });
  const output: Record<string, unknown> = {
    mode: apply ? 'apply' : 'dry-run',
    helperBoardIds,
    unverifiedSources,
    ...report,
  };

  if (apply && report.integrationIds.length > 0) {
    const queue = await import('@timeline/shared/queue');
    const followups = await scope.integrations.listMondayHelperRepairFollowups();
    const followupResults = await runMondayHelperRepairFollowups({
      followups,
      enqueueBackfill: (integrationId) =>
        queue.enqueueIntegrationSyncJob({
          kind: 'backfill',
          integrationId,
          teamId,
          triggeredBy: userId,
        }),
      reconcileWebhooks: async (integrationId) => {
        await adminReconcileIntegrationWebhookSubscriptions(db, integrationId);
      },
      markFollowup: (integrationId, patch) =>
        scope.integrations.markMondayHelperRepairFollowup(integrationId, patch),
    });
    for (const result of followupResults) {
      if (result.webhooks.status === 'failed') {
        await scope.integrations.recordConnectionAttention({
          integrationId: result.integrationId,
          category: 'webhook_degraded',
          summary: `Monday webhook reconciliation after helper-board repair failed: ${result.webhooks.error}`,
        });
      } else {
        await scope.integrations.resolveConnectionAttention({
          integrationId: result.integrationId,
          categories: ['webhook_degraded'],
        });
      }
      if (result.backfill.status === 'failed') {
        await scope.integrations.recordConnectionAttention({
          integrationId: result.integrationId,
          category: 'sync_error',
          summary: `Monday backfill after helper-board repair could not be queued: ${result.backfill.error}`,
        });
      }
    }
    output.backfillsQueued = followupResults.filter(
      (result) => result.backfill.status === 'ok',
    ).length;
    output.followups = followupResults;
  }

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
} finally {
  await closeDb();
}
