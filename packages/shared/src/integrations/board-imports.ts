import { createHash } from 'node:crypto';

import {
  agentSuggestionItems,
  agentSuggestions,
  boardImportEffects,
  boardImportLinks,
  boardImportRules,
  boardItems,
  boardLanes,
  boards,
  entities,
  integrationSelections,
  integrationSyncState,
  integrations,
  rawEvents,
  teamMembers,
  teamProviderResourceShares,
  type Db,
} from '@timeline/db';
import {
  BOARD_IMPORT_PROVIDERS,
  isBoardImportProvider,
  type BoardImportProvider,
} from '@timeline/db/integration-providers';
import { and, arrayOverlaps, desc, eq, exists, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import { createBoardScope } from '#src/boards/index.js';
import { assertBoardObjectType } from '#src/boards/qualification-policy.js';
import { recordsForImport, type ImportRecord } from '#src/integrations/import-records.js';
import {
  lockBoardImports,
  readableImportSource,
  visibleImportSources,
} from '#src/integrations/import-sources.js';
import { githubClosingIssueKeys } from '#src/integrations/providers/github.js';
import { adminDecryptIntegrationTokens } from '#src/integrations/scope.js';
import { createObjectScope } from '#src/objects/index.js';
import type { TeamScopeCore } from '#src/team-scope.js';
import { rawEventIsActive } from '#src/visibility.js';

export const boardImportConfig = z.object({
  integrationId: z.uuid(),
  resource: z.string().min(1).max(400),
  boardId: z.uuid(),
  projectId: z.uuid().nullable().default(null),
  issues: z.boolean().default(false),
  merges: z.boolean().default(false),
  history: z.boolean().default(false),
  stageLanes: z.record(z.string(), z.uuid()).default({}),
});
type Config = z.output<typeof boardImportConfig>;
type Rule = typeof boardImportRules.$inferSelect;
type Link = typeof boardImportLinks.$inferSelect;
interface Candidate {
  id: string;
  name: string;
}
export interface BoardImportPreviewRow {
  key: string;
  title: string;
  kind: string;
  action: 'Create' | 'Link to existing' | 'Review possible matches' | 'Skipped';
  reason: string;
  candidates: Candidate[];
  target: string | null;
  eventId: string;
}
const sourceKind = {
  github: 'github.repo',
  linear: 'linear.team',
  hubspot: 'hubspot.pipeline',
} as const satisfies Record<BoardImportProvider, string>;
function isBoardImportSource(source: { provider: string; kind: string }) {
  return isBoardImportProvider(source.provider) && source.kind === sourceKind[source.provider];
}

function eligible(
  record: ImportRecord,
  rule: Pick<Rule, 'importIssues' | 'mergedPrs' | 'mergesSince'>,
) {
  if (record.kind === 'issue') return rule.importIssues;
  if (record.kind === 'pr')
    return rule.mergedPrs && record.mergedAt && record.mergedAt >= rule.mergesSince;
  return true;
}

export function createBoardImportScope(db: Db, core: TeamScopeCore) {
  const { teamId, userId } = core;
  async function sources(query: Db, id?: string) {
    const selections = await query
      .select({
        id: integrations.id,
        provider: integrations.provider,
        account: integrations.externalAccountId,
        kind: integrationSelections.selectionKind,
        resource: integrationSelections.externalId,
        label: integrationSelections.externalLabel,
      })
      .from(integrations)
      .innerJoin(integrationSelections, eq(integrationSelections.integrationId, integrations.id))
      .leftJoin(
        teamProviderResourceShares,
        eq(integrationSelections.resourceShareId, teamProviderResourceShares.id),
      )
      .where(
        and(
          eq(integrations.teamId, teamId),
          eq(integrations.enabled, true),
          eq(integrations.visibilityDefault, 'team'),
          eq(integrationSelections.visibility, 'team'),
          inArray(integrations.provider, [...BOARD_IMPORT_PROVIDERS]),
          id ? eq(integrations.id, id) : undefined,
          or(
            isNull(integrations.providerConnectionId),
            and(
              eq(teamProviderResourceShares.teamId, teamId),
              eq(
                teamProviderResourceShares.providerConnectionId,
                integrations.providerConnectionId,
              ),
              eq(teamProviderResourceShares.resourceKind, integrationSelections.selectionKind),
              eq(teamProviderResourceShares.externalId, integrationSelections.externalId),
              isNull(teamProviderResourceShares.revokedAt),
            ),
          ),
        ),
      );
    const repositories = selections.filter(
      (s) => s.provider === 'github' && s.kind === 'github.org',
    );
    for (const org of repositories) {
      const repo = sql<string>`${rawEvents.sourceMetadata}->'github'->>'repo'`;
      const captured = await query
        .selectDistinct({ repo })
        .from(rawEvents)
        .where(
          and(
            eq(rawEvents.teamId, teamId),
            eq(rawEvents.source, 'integration'),
            eq(rawEvents.visibility, 'team'),
            rawEventIsActive(),
            sql`${rawEvents.sourceMetadata}->>'integration_id'=${org.id} and lower(split_part(${repo},'/',1))=lower(${org.resource})`,
          ),
        );
      for (const row of captured)
        if (
          row.repo &&
          !selections.some(
            (s) => s.id === org.id && s.kind === 'github.repo' && s.resource === row.repo,
          )
        )
          selections.push({ ...org, kind: 'github.repo', resource: row.repo, label: row.repo });
    }
    return selections;
  }
  async function source(query: Db, config: Config) {
    const selected = (await sources(query, config.integrationId)).find(
      (s) => s.resource === config.resource && isBoardImportSource(s),
    );
    if (!selected?.account) throw new Error('Select an active team-visible source.');
    return { ...selected, account: selected.account };
  }
  async function context(query: Db, config: Config) {
    const s = await source(query, config);
    const [board] = await query
      .select()
      .from(boards)
      .where(
        and(
          eq(boards.teamId, teamId),
          eq(boards.id, config.boardId),
          isNull(boards.archivedAt),
          or(eq(boards.isShared, true), eq(boards.createdBy, userId)),
        ),
      )
      .for('share');
    if (board) assertBoardObjectType(board, s.provider === 'hubspot' ? 'deal' : 'task');
    if (!board) throw new Error('Destination board is unavailable.');
    const lanes = await query
      .select()
      .from(boardLanes)
      .where(
        and(
          eq(boardLanes.teamId, teamId),
          eq(boardLanes.boardId, board.id),
          isNull(boardLanes.archivedAt),
        ),
      );
    if (Object.values(config.stageLanes).some((id) => !lanes.some((l) => l.id === id)))
      throw new Error('A mapped lane is unavailable.');
    if (
      s.provider === 'github' &&
      ((!config.issues && !config.merges) || (config.merges && !config.projectId))
    )
      throw new Error('Select a GitHub import option and a project for merged work.');
    if (s.provider === 'hubspot' && (config.issues || config.merges || config.projectId))
      throw new Error('Invalid pipeline options.');
    if (
      s.provider === 'linear' &&
      (config.merges || config.projectId || config.history || Object.keys(config.stageLanes).length)
    )
      throw new Error('Linear team imports sync issue status only.');
    if (config.projectId) {
      const [project] = await query
        .select({ id: entities.id })
        .from(entities)
        .where(
          and(
            eq(entities.teamId, teamId),
            eq(entities.id, config.projectId),
            eq(entities.type, 'project'),
            isNull(entities.archivedAt),
            isNull(entities.mergedIntoId),
          ),
        )
        .for('share');
      if (!project) throw new Error('Destination project is unavailable.');
    }
    const condition = and(
      eq(boardImportRules.teamId, teamId),
      eq(boardImportRules.provider, s.provider),
      eq(boardImportRules.externalAccountId, s.account),
      eq(boardImportRules.resourceId, s.resource),
    );

    const [existing] = await query.select().from(boardImportRules).where(condition);
    if (existing && existing.boardId !== board.id)
      throw new Error('This source already syncs to another board.');
    return { s, board, lanes, existing };
  }
  async function observations(
    query: Db,
    config: { integrationId: string; resource?: string },
    provider: string,
    issueIds?: string[],
  ) {
    if (issueIds && !issueIds.length) return [];
    const metadata = rawEvents.sourceMetadata;
    const rows = await query
      .selectDistinctOn([sql`${metadata}->>'external_object_id'`], {
        id: rawEvents.id,
        occurredAt: rawEvents.occurredAt,
        sourceMetadata: metadata,
      })
      .from(rawEvents)
      .where(
        and(
          eq(rawEvents.teamId, teamId),
          eq(rawEvents.source, 'integration'),
          eq(rawEvents.visibility, 'team'),
          rawEventIsActive(),
          sql`${metadata}->>'provider'=${provider} and ${metadata}->>'integration_id'=${config.integrationId}`,
          issueIds ? inArray(sql<string>`${metadata}->>'external_object_id'`, issueIds) : undefined,
          provider === 'github'
            ? sql`${metadata}->'github'->>'repo'=${config.resource} and ${metadata}->>'event_type' in ('pr.merged','issue.reopened','issue.closed','issue.updated')`
            : provider === 'linear'
              ? sql`${metadata} #>> '{linear,kind}'='issue'`
              : sql`${metadata}->'hubspot'->>'pipeline_id'=${config.resource}`,
        ),
      )
      .orderBy(
        sql`${metadata}->>'external_object_id'`,
        desc(rawEvents.occurredAt),
        desc(rawEvents.createdAt),
        desc(rawEvents.id),
      );
    const records = new Map<string, ImportRecord>();
    for (const record of rows.flatMap(recordsForImport)) {
      // Linear issues can move between teams. Choose the latest observation across the
      // connection before filtering by team so an old team cannot import a departed issue.
      if (config.resource !== undefined && record.resource !== config.resource) continue;
      const old = records.get(record.key);
      if (!old || old.sourceAt < record.sourceAt) records.set(record.key, record);
    }
    return [...records.values()].sort(
      (a, b) =>
        Number(a.kind !== 'company') - Number(b.kind !== 'company') ||
        Number(a.kind === 'pr') - Number(b.kind === 'pr') ||
        a.key.localeCompare(b.key),
    );
  }
  async function resolveMergedWork(
    query: Db,
    integrationId: string,
    records: ImportRecord[],
    links: Link[],
  ) {
    const prs = records.filter(
      (r) => r.kind === 'pr' && !r.closingIssues && !links.some((l) => l.recordKey === r.key),
    );
    if (!prs.length) return;
    const [integration] = await query
      .select()
      .from(integrations)
      .where(
        and(
          eq(integrations.teamId, teamId),
          eq(integrations.id, integrationId),
          eq(integrations.provider, 'github'),
          eq(integrations.enabled, true),
        ),
      );
    if (!integration) return;
    const tokens = await adminDecryptIntegrationTokens(query, integration);
    if (!tokens) return;
    for (const record of prs) {
      const number = Number(record.aliases[0]?.split('#').at(-1));
      if (Number.isSafeInteger(number) && number > 0) {
        try {
          record.closingIssues = await githubClosingIssueKeys(tokens, record.resource, number);
        } catch {
          /* Leave this PR pending until its closing references can be verified. */
        }
      }
    }
  }
  async function previewRows(
    query: Db,
    records: ImportRecord[],
    rule: Pick<Rule, 'stageLanes' | 'provider' | 'externalAccountId'>,
    links: Link[],
  ) {
    const rows: BoardImportPreviewRow[] = [];
    for (const record of records) {
      const own = links.find((l) => l.recordKey === record.key);
      const entry: BoardImportPreviewRow = {
        key: record.key,
        title: record.title,
        kind: record.kind,
        action: 'Create',
        reason: '',
        target: null,
        eventId: record.eventId,
        candidates: [],
      };
      rows.push(entry);
      if (own) {
        entry.target = own.entityId;
        entry.action = own.state === 'unlinked' ? 'Skipped' : 'Link to existing';
        entry.reason =
          own.state === 'unlinked'
            ? 'Sync stopped'
            : !record.active && record.kind === 'issue'
              ? 'Issue removed from Linear'
              : 'Previously linked';
      } else if (!record.active) {
        entry.action = 'Skipped';
        entry.reason =
          record.kind === 'issue' ? 'Issue removed from Linear' : 'Outside the selected pipeline';
      }
      if (entry.action === 'Skipped') continue;
      if (record.stage && !rule.stageLanes[record.stage]) {
        entry.action = 'Review possible matches';
        entry.reason = 'Map the source stage to a lane';
        continue;
      }
      if (own) continue;
      if (record.kind === 'pr' && !record.closingIssues) {
        entry.action = 'Review possible matches';
        entry.reason = 'Awaiting confirmed issue links from GitHub';
        continue;
      }
      if (record.kind === 'pr' && record.closingIssues?.length) {
        const hits = links.filter(
          (l) => l.state === 'active' && record.closingIssues?.includes(l.recordKey),
        );
        if (
          hits.length === record.closingIssues.length &&
          new Set(hits.map((l) => l.entityId)).size === 1 &&
          hits[0]
        ) {
          entry.target = hits[0].entityId;
          entry.action = 'Link to existing';
          entry.reason = 'Linked GitHub issue';
        } else {
          entry.action = 'Review possible matches';
          entry.reason = 'Review linked issues';
          if (hits.length)
            entry.candidates = await query
              .select({ id: entities.id, name: entities.canonicalName })
              .from(entities)
              .where(
                and(
                  eq(entities.teamId, teamId),
                  inArray(
                    entities.id,
                    hits.map((l) => l.entityId),
                  ),
                  isNull(entities.archivedAt),
                  isNull(entities.mergedIntoId),
                ),
              );
        }
        continue;
      }
      if (record.type === 'company' || record.type === 'deal') {
        const identities = await query
          .selectDistinct({ id: entities.id, name: entities.canonicalName })
          .from(boardImportLinks)
          .innerJoin(boardImportRules, eq(boardImportRules.id, boardImportLinks.ruleId))
          .innerJoin(boards, eq(boards.id, boardImportRules.boardId))
          .innerJoin(entities, eq(entities.id, boardImportLinks.entityId))
          .innerJoin(rawEvents, eq(rawEvents.id, boardImportLinks.sourceEventId))
          .where(
            and(
              eq(boardImportLinks.teamId, teamId),
              eq(boardImportRules.provider, rule.provider),
              eq(boardImportRules.externalAccountId, rule.externalAccountId),
              eq(boardImportLinks.recordKey, record.key),
              inArray(boardImportLinks.state, ['active', 'paused']),
              eq(rawEvents.visibility, 'team'),
              rawEventIsActive(),
              or(eq(boards.isShared, true), eq(boards.createdBy, userId)),
              isNull(entities.archivedAt),
              isNull(entities.mergedIntoId),
            ),
          );
        if (identities.length === 1 && identities[0]) {
          entry.action = 'Link to existing';
          entry.reason = 'Previously matched in this account';
          entry.target = identities[0].id;
          continue;
        }
        if (identities.length) {
          entry.action = 'Review possible matches';
          entry.candidates = identities;
          entry.reason = 'Choose the existing record';
          continue;
        }
      }
      if (record.linearIssueId) {
        const matches = await query
          .select({
            id: entities.id,
            name: entities.canonicalName,
            archivedAt: entities.archivedAt,
          })
          .from(entities)
          .where(
            and(
              eq(entities.teamId, teamId),
              eq(entities.type, 'task'),
              isNull(entities.mergedIntoId),
              or(
                sql`${entities.metadata}->>'integration_provider'='linear' and ${entities.metadata}->>'integration_external_id'=${record.linearIssueId}`,
                exists(
                  query
                    .select({ id: boardImportLinks.id })
                    .from(boardImportLinks)
                    .innerJoin(boardImportRules, eq(boardImportRules.id, boardImportLinks.ruleId))
                    .innerJoin(boards, eq(boards.id, boardImportRules.boardId))
                    .innerJoin(rawEvents, eq(rawEvents.id, boardImportLinks.sourceEventId))
                    .where(
                      and(
                        eq(boardImportLinks.entityId, entities.id),
                        eq(boardImportLinks.teamId, teamId),
                        eq(boardImportRules.provider, rule.provider),
                        eq(boardImportRules.externalAccountId, rule.externalAccountId),
                        eq(boardImportLinks.recordKey, record.key),
                        readableImportSource(userId),
                      ),
                    ),
                ),
              ),
            ),
          )
          .orderBy(entities.id);
        if (matches.length) {
          entry.candidates = matches
            .filter((m) => !m.archivedAt)
            .map(({ id, name }) => ({ id, name }));
          if (!entry.candidates.length) {
            entry.action = 'Skipped';
            entry.reason = 'Restore the archived Linear task to link it';
          } else if (entry.candidates.length === 1 && entry.candidates[0]) {
            entry.action = 'Link to existing';
            entry.reason = 'Same Linear issue ID';
            entry.target = entry.candidates[0].id;
            entry.candidates = [];
          } else {
            entry.action = 'Review possible matches';
            entry.reason = 'Choose the task linked to this Linear issue';
          }
          continue;
        }
      }
      const needles = [
        ...new Set([record.title, ...record.aliases].map((name) => name.toLowerCase())),
      ];
      const aliases = sql.join(
        needles.map((n) => sql`${n}`),
        sql`,`,
      );

      const candidates = await query
        .select({ id: entities.id, name: entities.canonicalName })
        .from(entities)
        .where(
          and(
            eq(entities.teamId, teamId),
            eq(entities.type, record.type),
            isNull(entities.archivedAt),
            isNull(entities.mergedIntoId),
            or(
              inArray(sql<string>`lower(${entities.canonicalName})`, needles),
              sql`${entities.metadata}->>'integration_provider'=${rule.provider} and lower(${entities.metadata}->>'integration_external_id') in (${aliases})`,
              sql`exists (select 1 from jsonb_array_elements_text(${entities.aliases}) a where lower(a) in (${sql.join(
                needles.map((n) => sql`${n}`),
                sql`,`,
              )}))`,
            ),
          ),
        )
        .orderBy(entities.id)
        .limit(20);
      const [pending] =
        record.type === 'task'
          ? await query
              .select({ id: agentSuggestionItems.id })
              .from(agentSuggestionItems)
              .innerJoin(
                agentSuggestions,
                eq(agentSuggestionItems.suggestionId, agentSuggestions.id),
              )
              .where(
                and(
                  eq(agentSuggestions.teamId, teamId),
                  eq(agentSuggestions.visibility, 'team'),
                  eq(agentSuggestionItems.teamId, teamId),
                  eq(agentSuggestionItems.operation, 'create'),
                  eq(agentSuggestionItems.targetKind, 'task'),
                  eq(agentSuggestionItems.status, 'pending'),
                  or(
                    inArray(
                      sql<string>`lower(coalesce(${agentSuggestionItems.proposedPayload}->>'canonicalName',${agentSuggestionItems.title}))`,
                      needles,
                    ),
                    sql`exists (select 1 from jsonb_array_elements_text(case when jsonb_typeof(${agentSuggestionItems.proposedPayload}->'aliases')='array' then ${agentSuggestionItems.proposedPayload}->'aliases' else '[]'::jsonb end) a where lower(a) in (${aliases}))`,
                  ),
                ),
              )
              .limit(1)
          : [];
      if (candidates.length || pending) {
        entry.action = 'Review possible matches';
        entry.candidates = candidates;
        entry.reason = pending ? 'A task is awaiting approval' : 'Confirm the matching record';
      } else if (
        await query
          .select({ id: entities.id })
          .from(entities)
          .where(
            and(
              eq(entities.teamId, teamId),
              eq(entities.type, record.type),
              isNull(entities.mergedIntoId),
              sql`${entities.archivedAt} is not null and lower(${entities.canonicalName})=lower(${record.title})`,
            ),
          )
          .limit(1)
          .then((rows) => rows.length > 0)
      ) {
        entry.action = 'Skipped';
        entry.reason = 'An archived record uses this name. Restore it to link it.';
      } else if (
        rows.some(
          (other) =>
            other !== entry &&
            other.kind === entry.kind &&
            other.title.toLowerCase() === entry.title.toLowerCase() &&
            other.action === 'Create',
        )
      ) {
        entry.action = 'Review possible matches';
        entry.reason = 'Review after the other record with this name has been imported';
      }
    }
    return rows;
  }
  async function prepare(query: Db, config: Config) {
    const ctx = await context(query, config);
    const { existing } = ctx;
    const rule = {
      provider: ctx.s.provider,
      externalAccountId: ctx.s.account,
      importIssues: ctx.s.provider === 'linear' || config.issues,
      mergedPrs: config.merges,
      mergesSince: config.history
        ? new Date(0)
        : existing?.mergedPrs && existing.mergesSince.getTime() > 0
          ? existing.mergesSince
          : new Date(),
      stageLanes: config.stageLanes,
    };
    const all = await observations(query, config, ctx.s.provider);
    const records = all.filter((record) => eligible(record, rule));
    const links = existing
      ? await query
          .select()
          .from(boardImportLinks)
          .where(and(eq(boardImportLinks.ruleId, existing.id), eq(boardImportLinks.teamId, teamId)))
      : [];
    await resolveMergedWork(query, config.integrationId, records, links);
    const rows = await previewRows(query, records, rule, links);
    for (const [i, record] of records.entries()) {
      const row = rows[i];
      if (!row) continue;
      if (
        record.kind === 'pr' &&
        record.closingIssues?.length === 1 &&
        row.reason === 'Review linked issues' &&
        records.some((r) => r.key === record.closingIssues?.[0])
      ) {
        row.reason = 'Uses the linked issue’s task once its match is resolved';
      } else if (
        record.kind === 'deal' &&
        row.action === 'Create' &&
        rows.some(
          (other) =>
            record.companies.includes(other.key) && other.action === 'Review possible matches',
        )
      ) {
        row.reason = 'Created after the associated company is matched';
      }
    }
    const [syncState] =
      ctx.s.provider === 'hubspot'
        ? await query
            .select({ cursor: integrationSyncState.cursor })
            .from(integrationSyncState)
            .where(
              and(
                eq(integrationSyncState.integrationId, config.integrationId),
                eq(integrationSyncState.resourceType, 'hubspot.pipeline:' + config.resource),
              ),
            )
        : [];
    const catalog = z
      .object({ stages: z.record(z.string(), z.string()) })
      .safeParse(syncState?.cursor);
    const stages = catalog.success
      ? catalog.data.stages
      : Object.fromEntries(
          all.flatMap((r) => (r.stage ? [[r.stage, r.stageLabel ?? r.stage]] : [])),
        );
    const revision = createHash('sha256')
      .update(JSON.stringify([config, existing?.id, rows, stages]))
      .digest('hex');
    return { ...ctx, rule, records, links, rows, revision, stages };
  }
  async function applyRecord(
    query: Db,
    txCore: TeamScopeCore,
    rule: Rule,
    record: ImportRecord,
    entry: BoardImportPreviewRow,
    links: Link[],
    choice?: string,
  ) {
    const own = links.find((l) => l.recordKey === record.key);
    if (own && (own.state === 'unlinked' || own.sourceAt > record.sourceAt)) return;
    if (
      own?.sourceAt.getTime() === record.sourceAt.getTime() &&
      own.sourceEventId !== record.eventId
    ) {
      const [latest] = await query
        .select({ id: rawEvents.id })
        .from(rawEvents)
        .where(
          and(
            eq(rawEvents.teamId, teamId),
            inArray(rawEvents.id, [own.sourceEventId, record.eventId]),
          ),
        )
        .orderBy(desc(rawEvents.createdAt), desc(rawEvents.id))
        .limit(1);
      if (latest?.id !== record.eventId) return;
    }
    if (own?.state === 'active' && own.sourceEventId === record.eventId && record.kind !== 'deal')
      return;
    if (entry.action === 'Skipped') return;
    if (!record.active) {
      if (own) {
        const patch = { state: 'paused', sourceAt: record.sourceAt, sourceEventId: record.eventId };
        await query.update(boardImportLinks).set(patch).where(eq(boardImportLinks.id, own.id));
        Object.assign(own, patch);
      }
      return;
    }
    const matchedCompanies: Link[] = [];
    const missingCompanies: string[] = [];
    for (const key of record.companies) {
      const company = links.find((l) => l.recordKey === key && l.state === 'active');
      if (company) matchedCompanies.push(company);
      else missingCompanies.push(key);
    }
    if (!own && missingCompanies.length) return missingCompanies;
    if (
      entry.action === 'Review possible matches' &&
      !entry.candidates.some((c) => c.id === choice) &&
      !(entry.reason === 'Confirm the matching record' && choice === 'create')
    )
      return;
    const objectScope = createObjectScope(query, txCore);
    const boardScope = createBoardScope({ db: query, scope: txCore, objects: objectScope });
    const actor = { kind: 'system' as const, userId };
    const existingId = entry.target ?? entry.candidates.find((c) => c.id === choice)?.id;
    const canonicalName =
      choice === 'create'
        ? record.title + ' (' + rule.provider + ' ' + record.key + ')'
        : record.title;
    if (
      existingId &&
      (record.kind === 'issue' ||
        (record.kind === 'pr' && !record.closingIssues?.length) ||
        record.kind === 'deal')
    ) {
      const [other] = await query
        .select({ id: boardImportLinks.id })
        .from(boardImportLinks)
        .innerJoin(boardImportRules, eq(boardImportRules.id, boardImportLinks.ruleId))
        .where(
          and(
            eq(boardImportLinks.teamId, teamId),
            eq(boardImportLinks.entityId, existingId),
            eq(boardImportLinks.state, 'active'),
            record.kind === 'deal'
              ? and(eq(boardImportRules.boardId, rule.boardId), eq(boardImportLinks.field, 'lane'))
              : eq(boardImportLinks.field, 'status'),
          ),
        );
      if (other && other.id !== own?.id) return;
    }
    if (!existingId) {
      const [collision] = await query
        .select({ id: entities.id })
        .from(entities)
        .where(
          and(
            eq(entities.teamId, teamId),
            eq(entities.type, record.type),
            isNull(entities.mergedIntoId),
            sql`lower(${entities.canonicalName})=lower(${canonicalName})`,
          ),
        )
        .limit(1);
      if (collision) return;
    }
    const entity = existingId
      ? (
          await query
            .select({
              id: entities.id,
              type: entities.type,
              status: entities.status,
              archivedAt: entities.archivedAt,
            })
            .from(entities)
            .where(
              and(
                eq(entities.teamId, teamId),
                eq(entities.id, existingId),
                isNull(entities.mergedIntoId),
              ),
            )
            .for('update')
        )[0]
      : await objectScope.createObject({
          type: record.type,
          canonicalName,
          ...(record.status ? { status: record.status } : {}),
          aliases: record.aliases,
          ...(record.type === 'task' && rule.projectId ? { parentObjectId: rule.projectId } : {}),
          actor,
        });
    if (entity?.type !== record.type || entity.archivedAt) return;
    let itemId = own?.itemId ?? null;
    const lane = record.stage ? rule.stageLanes[record.stage] : undefined;
    if (record.type !== 'company' && !itemId) {
      const [existing] = await query
        .select({ id: boardItems.id })
        .from(boardItems)
        .where(
          and(
            eq(boardItems.teamId, teamId),
            eq(boardItems.boardId, rule.boardId),
            eq(boardItems.entityId, entity.id),
            isNull(boardItems.archivedAt),
          ),
        );
      itemId =
        existing?.id ??
        (
          await boardScope.addBoardItem(rule.boardId, {
            entityId: entity.id,
            ...(lane ? { laneId: lane } : {}),
            actor,
          })
        ).id;
    }
    const field =
      record.kind === 'issue' ? 'status' : record.kind === 'deal' ? 'lane' : 'reference';
    let link = own;
    if (!link) {
      [link] = await query
        .insert(boardImportLinks)
        .values({
          teamId,
          ruleId: rule.id,
          recordKey: record.key,
          field,
          entityId: entity.id,
          itemId,
          sourceAt: record.sourceAt,
          sourceEventId: record.eventId,
          sourceUrl: record.url,
          state: 'active',
        })
        .returning();
      if (!link) throw new Error('Could not link imported record');
      links.push(link);
    }
    await query.execute(sql`select set_config('timeline.import_link',${link.id},true)`);
    if (
      (record.kind === 'issue' ||
        (record.kind === 'pr' && !own && !record.closingIssues?.length)) &&
      record.status &&
      entity.status !== record.status
    )
      await objectScope.updateObject(entity.id, { status: record.status }, actor);
    if (itemId && lane) {
      const [item] = await query
        .select({ lane: boardItems.laneId })
        .from(boardItems)
        .where(
          and(
            eq(boardItems.teamId, teamId),
            eq(boardItems.id, itemId),
            isNull(boardItems.archivedAt),
          ),
        );
      if (item && item.lane !== lane)
        await boardScope.updateBoardItem(itemId, { laneId: lane }, actor);
    }
    for (const company of matchedCompanies) {
      await objectScope.addRelationship({
        fromEntityId: entity.id,
        toEntityId: company.entityId,
        kind: 'related',
        actorUserId: userId,
        actor,
      });
    }
    const patch = {
      state: 'active',
      sourceEventId: record.eventId,
      sourceAt: record.sourceAt,
      sourceUrl: record.url,
    };
    await query.update(boardImportLinks).set(patch).where(eq(boardImportLinks.id, link.id));
    Object.assign(link, patch);
    return missingCompanies;
  }

  async function apply(
    query: Db,
    txCore: TeamScopeCore,
    rule: Rule,
    record: ImportRecord,
    entry: BoardImportPreviewRow,
    links: Link[],
    choice?: string,
  ) {
    const missingCompanies = await applyRecord(query, txCore, rule, record, entry, links, choice);
    const link = links.find((l) => l.recordKey === record.key);
    const state =
      link?.state === 'unlinked' ||
      entry.action === 'Skipped' ||
      (link && link.sourceAt > record.sourceAt)
        ? 'skipped'
        : link?.sourceEventId === record.eventId && !missingCompanies?.length
          ? 'applied'
          : 'waiting';
    const values = {
      state,
      entityId: link?.entityId ?? null,
      waitingOn:
        state === 'waiting'
          ? [...(record.closingIssues ?? []), ...(missingCompanies ?? record.companies)]
          : [],
    };
    await query
      .insert(boardImportEffects)
      .values({
        teamId,
        ruleId: rule.id,
        recordKey: record.key,
        sourceEventId: record.eventId,
        ...values,
      })
      .onConflictDoUpdate({
        target: [
          boardImportEffects.ruleId,
          boardImportEffects.recordKey,
          boardImportEffects.sourceEventId,
        ],
        set: values,
        setWhere: eq(boardImportEffects.state, 'waiting'),
      });
  }
  async function transaction<T>(work: (query: Db, txCore: TeamScopeCore) => Promise<T>) {
    const effects: NonNullable<TeamScopeCore['postCommitEffects']> = [];
    const authorizedRole = await core.requireMembership('admin');
    if (authorizedRole !== 'owner' && authorizedRole !== 'admin')
      throw new Error('An active team admin is required.');
    const result = await db.transaction(async (tx) => {
      const query = tx as unknown as Db;
      await lockBoardImports(query, teamId);
      const [role] = await tx
        .select({ role: teamMembers.role })
        .from(teamMembers)
        .where(
          and(
            eq(teamMembers.teamId, teamId),
            eq(teamMembers.userId, userId),
            isNull(teamMembers.removedAt),
            inArray(teamMembers.role, ['owner', 'admin']),
          ),
        )
        .for('share');
      if (!role) throw new Error('An active team admin is required.');
      return work(query, {
        ...core,
        requireMembership: (minRole) => {
          if (minRole === 'owner' && role.role !== 'owner') throw new Error('Owner role required');
          return Promise.resolve(role.role);
        },
        postCommitEffects: effects,
        postCommitDb: db,
      });
    });
    for (const effect of effects) await effect();
    return result;
  }
  return {
    async handledEvents(eventIds: string[]) {
      await core.requireMembership();
      if (!eventIds.length) return [];
      const rows = await db
        .selectDistinct({ id: boardImportEffects.sourceEventId })
        .from(boardImportEffects)
        .innerJoin(rawEvents, eq(rawEvents.id, boardImportEffects.sourceEventId))
        .where(
          and(
            eq(boardImportEffects.teamId, teamId),
            eq(rawEvents.visibility, 'team'),
            rawEventIsActive(),
            inArray(boardImportEffects.sourceEventId, eventIds),
          ),
        );
      return rows.map((row) => row.id);
    },
    async authorizedWorkers(provider: string, account: string) {
      await core.requireMembership();
      const rows = await db
        .selectDistinct({ actor: boardImportRules.authorizedBy })
        .from(boardImportRules)
        .innerJoin(
          teamMembers,
          and(
            eq(teamMembers.teamId, teamId),
            eq(teamMembers.userId, boardImportRules.authorizedBy),
            isNull(teamMembers.removedAt),
            inArray(teamMembers.role, ['admin', 'owner']),
          ),
        )
        .where(
          and(
            eq(boardImportRules.teamId, teamId),
            eq(boardImportRules.provider, provider),
            eq(boardImportRules.externalAccountId, account),
          ),
        );
      return rows.map((row) => row.actor);
    },
    async ownership(target: { entityId?: string; itemId?: string }) {
      const role = await core.requireMembership();
      const id = target.itemId ?? target.entityId;
      return id
        ? visibleImportSources(db, teamId, userId, role, target.itemId ? 'item' : 'entity', [id])
        : [];
    },
    async options() {
      await core.requireMembership('admin');
      const boardScope = createBoardScope({
        db,
        scope: core,
        objects: createObjectScope(db, core),
      });
      const available = await sources(db);
      const projects = await db
        .select({ id: entities.id, name: entities.canonicalName })
        .from(entities)
        .where(
          and(
            eq(entities.teamId, teamId),
            eq(entities.type, 'project'),
            isNull(entities.archivedAt),
            isNull(entities.mergedIntoId),
          ),
        );
      const visibleBoards = await boardScope.listBoards();
      const rules = visibleBoards.length
        ? await db
            .select()
            .from(boardImportRules)
            .where(
              and(
                eq(boardImportRules.teamId, teamId),
                inArray(
                  boardImportRules.boardId,
                  visibleBoards.map((b) => b.id),
                ),
              ),
            )
        : [];
      return {
        sources: available.filter(isBoardImportSource).map((s) => {
          const rule = rules.find(
            (r) =>
              r.externalAccountId === s.account &&
              r.provider === s.provider &&
              r.resourceId === s.resource,
          );
          return {
            ...s,
            settings: rule
              ? {
                  boardId: rule.boardId,
                  projectId: rule.projectId,
                  issues: rule.importIssues,
                  merges: rule.mergedPrs,
                  history: rule.mergesSince.getTime() === 0,
                  stageLanes: rule.stageLanes,
                }
              : null,
          };
        }),
        boards: visibleBoards,
        projects,
      };
    },
    async preview(config: Config) {
      await core.requireMembership('admin');
      const { rows, revision, stages, lanes } = await prepare(db, config);
      return { rows, revision, stages, lanes: lanes.map((l) => ({ id: l.id, name: l.name })) };
    },
    async confirm(config: Config, revision: string, choices: Record<string, string>) {
      return transaction(async (query, txCore) => {
        const prepared = await prepare(query, config);
        if (prepared.revision !== revision)
          throw new Error('The preview changed. Review it again.');
        if (prepared.s.provider === 'hubspot') {
          const stages = Object.keys(prepared.stages);
          if (!stages.length || stages.some((stage) => !config.stageLanes[stage]))
            throw new Error('Map each pipeline stage before confirming.');
        }
        const values = {
          authorizedBy: userId,
          boardId: config.boardId,
          projectId: config.projectId,
          ...prepared.rule,
        };
        const [rule] = prepared.existing
          ? await query
              .update(boardImportRules)
              .set(values)
              .where(eq(boardImportRules.id, prepared.existing.id))
              .returning()
          : await query
              .insert(boardImportRules)
              .values({ teamId, resourceId: config.resource, ...values })
              .returning();
        if (!rule) throw new Error('Could not save import.');
        if (!rule.importIssues && rule.provider === 'github') {
          await query
            .update(boardImportLinks)
            .set({ state: 'paused' })
            .where(
              and(
                eq(boardImportLinks.teamId, teamId),
                eq(boardImportLinks.ruleId, rule.id),
                eq(boardImportLinks.field, 'status'),
                eq(boardImportLinks.state, 'active'),
              ),
            );
        }
        for (const [i, record] of prepared.records.entries()) {
          const entry =
            record.kind === 'pr' && record.closingIssues?.length
              ? (await previewRows(query, [record], rule, prepared.links))[0]
              : prepared.rows[i];
          if (!entry) throw new Error('The preview changed. Review it again.');
          await apply(query, txCore, rule, record, entry, prepared.links, choices[record.key]);
        }
        return rule.id;
      });
    },
    async applyEvents(integrationId: string, eventIds: string[]): Promise<string[]> {
      if (!eventIds.length) return [];
      // Discover rule owners before entering each authorized transaction. Worker calls this
      // with the rule author's real principal and never inherits the connection owner's role.
      return transaction(async (query, txCore) => {
        const [integration] = await query
          .select()
          .from(integrations)
          .where(
            and(
              eq(integrations.teamId, teamId),
              eq(integrations.id, integrationId),
              eq(integrations.enabled, true),
            ),
          )
          .for('share');
        if (!integration?.externalAccountId) return [];
        const rules = await query
          .select()
          .from(boardImportRules)
          .where(
            and(
              eq(boardImportRules.teamId, teamId),
              eq(boardImportRules.authorizedBy, userId),
              eq(boardImportRules.externalAccountId, integration.externalAccountId),
              eq(boardImportRules.provider, integration.provider),
            ),
          )
          .for('update');
        const events = await query
          .select({
            id: rawEvents.id,
            occurredAt: rawEvents.occurredAt,
            sourceMetadata: rawEvents.sourceMetadata,
          })
          .from(rawEvents)
          .where(
            and(
              eq(rawEvents.teamId, teamId),
              eq(rawEvents.source, 'integration'),
              eq(rawEvents.visibility, 'team'),
              rawEventIsActive(),
              inArray(rawEvents.id, eventIds),
              sql`${rawEvents.sourceMetadata}->>'integration_id'=${integrationId} and ${rawEvents.sourceMetadata}->>'provider'=${integration.provider}`,
            ),
          )
          .orderBy(rawEvents.occurredAt)
          .for('share');
        const managed = new Set<string>();
        const authorized = rules.length ? await sources(query, integrationId) : [];
        const delivered = events.flatMap(recordsForImport);
        const current =
          integration.provider === 'linear' && rules.length
            ? await observations(
                query,
                { integrationId },
                'linear',
                delivered.flatMap((r) => (r.linearIssueId ? [r.linearIssueId] : [])),
              )
            : delivered;
        for (const rule of rules) {
          const config = {
            integrationId,
            resource: rule.resourceId,
            boardId: rule.boardId,
            projectId: rule.projectId,
            issues: rule.importIssues,
            merges: rule.mergedPrs,
            history: false,
            stageLanes: rule.stageLanes,
          };

          if (!authorized.some((s) => s.resource === rule.resourceId && isBoardImportSource(s)))
            continue;
          const [destination] = await query
            .select()
            .from(boards)
            .where(
              and(
                eq(boards.teamId, teamId),
                eq(boards.id, rule.boardId),
                isNull(boards.archivedAt),
                or(eq(boards.isShared, true), eq(boards.createdBy, userId)),
              ),
            )
            .for('share');
          if (!destination) continue;
          const allowedType = rule.provider === 'hubspot' ? 'deal' : 'task';
          if (
            destination.strictObjectTypes &&
            !(
              Array.isArray(destination.recommendedObjectTypes) &&
              destination.recommendedObjectTypes.includes(allowedType)
            )
          )
            continue;
          if (rule.projectId) {
            const [project] = await query
              .select({ id: entities.id })
              .from(entities)
              .where(
                and(
                  eq(entities.teamId, teamId),
                  eq(entities.id, rule.projectId),
                  eq(entities.type, 'project'),
                  isNull(entities.archivedAt),
                  isNull(entities.mergedIntoId),
                ),
              )
              .for('share');
            if (!project) continue;
          }
          const lanes = await query
            .select({ id: boardLanes.id })
            .from(boardLanes)
            .where(
              and(
                eq(boardLanes.teamId, teamId),
                eq(boardLanes.boardId, rule.boardId),
                isNull(boardLanes.archivedAt),
              ),
            );
          const activeLanes = new Set(lanes.map((l) => l.id));
          rule.stageLanes = Object.fromEntries(
            Object.entries(rule.stageLanes).filter(([, lane]) => activeLanes.has(lane)),
          );
          const links = await query
            .select()
            .from(boardImportLinks)
            .where(and(eq(boardImportLinks.teamId, teamId), eq(boardImportLinks.ruleId, rule.id)))
            .for('update');
          if (integration.provider === 'linear') {
            for (const record of delivered) {
              if (record.resource === rule.resourceId) managed.add(record.eventId);
            }
          }
          const eventRecords = current;
          const availableKeys = eventRecords
            .filter(
              (r) => r.resource === rule.resourceId && (r.kind === 'issue' || r.kind === 'company'),
            )
            .map((r) => r.key);
          const pending = availableKeys.length
            ? await query
                .selectDistinct({
                  id: rawEvents.id,
                  occurredAt: rawEvents.occurredAt,
                  sourceMetadata: rawEvents.sourceMetadata,
                })
                .from(boardImportEffects)
                .innerJoin(rawEvents, eq(rawEvents.id, boardImportEffects.sourceEventId))
                .where(
                  and(
                    eq(boardImportEffects.teamId, teamId),
                    eq(boardImportEffects.ruleId, rule.id),
                    eq(boardImportEffects.state, 'waiting'),
                    arrayOverlaps(boardImportEffects.waitingOn, availableKeys),
                    eq(rawEvents.visibility, 'team'),
                    rawEventIsActive(),
                    sql`${rawEvents.sourceMetadata}->>'integration_id'=${integrationId}`,
                  ),
                )
            : [];
          const records = [...eventRecords, ...pending.flatMap(recordsForImport)];
          records.sort(
            (a, b) =>
              Number(a.kind === 'pr' || a.kind === 'deal') -
                Number(b.kind === 'pr' || b.kind === 'deal') ||
              a.sourceAt.getTime() - b.sourceAt.getTime(),
          );
          for (const record of records) {
            if (record.resource !== config.resource) {
              // A team transfer releases the old rule without applying the new team's status.
              if (
                record.linearIssueId &&
                links.some((link) => link.recordKey === record.key && link.state === 'active')
              ) {
                await query
                  .update(boardImportLinks)
                  .set({ state: 'paused', sourceAt: record.sourceAt })
                  .where(
                    and(
                      eq(boardImportLinks.teamId, teamId),
                      eq(boardImportLinks.ruleId, rule.id),
                      eq(boardImportLinks.recordKey, record.key),
                      eq(boardImportLinks.state, 'active'),
                      sql`${boardImportLinks.sourceAt} <= ${record.sourceAt.toISOString()}::timestamptz`,
                    ),
                  );
              }
              continue;
            }
            if (!eligible(record, rule)) continue;
            managed.add(record.eventId);
            await resolveMergedWork(query, integrationId, [record], links);
            const [entry] = await previewRows(query, [record], rule, links);
            if (entry) await apply(query, txCore, rule, record, entry, links);
          }
        }
        return [...managed];
      });
    },
    async unlink(id: string) {
      await transaction(async (query) => {
        const [link] = await query
          .select({ id: boardImportLinks.id })
          .from(boardImportLinks)
          .innerJoin(boardImportRules, eq(boardImportRules.id, boardImportLinks.ruleId))
          .innerJoin(boards, eq(boards.id, boardImportRules.boardId))
          .where(
            and(
              eq(boardImportLinks.teamId, teamId),
              eq(boardImportLinks.id, id),
              or(eq(boards.isShared, true), eq(boards.createdBy, userId)),
            ),
          )
          .for('update');
        if (!link) throw new Error('Link unavailable.');
        await query
          .update(boardImportLinks)
          .set({ state: 'unlinked' })
          .where(eq(boardImportLinks.id, id));
      });
    },
  };
}
