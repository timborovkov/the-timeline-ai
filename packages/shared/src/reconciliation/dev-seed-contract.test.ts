import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

function repoFile(path: string): string {
  return readFileSync(resolve(process.cwd(), '../..', path), 'utf8');
}

function repoPath(path: string): string {
  return resolve(process.cwd(), '../..', path);
}

function relativeRepoPath(path: string): string {
  return relative(repoPath('.'), path);
}

const APPLICATION_SOURCE_ROOTS = [
  'apps/web/src',
  'apps/worker/src',
  'packages/shared/src',
  'scripts',
];

function repoSourceFiles(paths: string[]): string[] {
  return paths.flatMap((path) => walkSourceFiles(repoPath(path)));
}

function walkSourceFiles(path: string): string[] {
  const stat = statSync(path);
  if (stat.isFile()) return shouldScanSourceFile(path) ? [path] : [];
  return readdirSync(path).flatMap((entry) => walkSourceFiles(join(path, entry)));
}

function shouldScanSourceFile(path: string): boolean {
  if (!['.ts', '.tsx'].includes(extname(path))) return false;
  return ![
    '.test.ts',
    '.test.tsx',
    '.live-eval.test.ts',
    '/packages/db/src/schema/',
    '/packages/shared/src/reconciliation/dev-seed-contract.test.ts',
  ].some((excluded) => path.includes(excluded));
}

function scannedApplicationSources(): string {
  return repoSourceFiles(APPLICATION_SOURCE_ROOTS)
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n');
}

function rawEventWriterFiles(): string[] {
  return repoSourceFiles(APPLICATION_SOURCE_ROOTS)
    .filter((path) => {
      const source = readFileSync(path, 'utf8');
      return /\.insert\(rawEvents\)|\binsert\(rawEvents\)|INSERT INTO raw_events/.test(source);
    })
    .map(relativeRepoPath)
    .sort();
}

function statementSlices(source: string, marker: string): string[] {
  const slices: string[] = [];
  let start = source.indexOf(marker);
  while (start >= 0) {
    const end = source.indexOf(';', start);
    slices.push(source.slice(start, end >= 0 ? end : undefined));
    start = source.indexOf(marker, start + marker.length);
  }
  return slices;
}

function functionSignature(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}`);
  if (start < 0) throw new Error(`missing function ${name}`);
  const end = source.indexOf('): Promise<', start);
  if (end < 0) throw new Error(`missing return type for ${name}`);
  return source.slice(start, end);
}

describe('reconciliation cutover contracts', () => {
  it('does not stamp canonical object provenance with legacy sourceEventId writes', () => {
    const source = repoFile('scripts/seed-dev.ts');

    expect(source).not.toMatch(/sourceEventId:\s*IDS\.event/);
    expect(source).not.toContain('sourceEventId: sql`excluded.source_event_id`');
    expect(source).toContain('reconciliationEvidence');
    expect(source).toContain('artifactEvidenceAssociations');
    expect(source).toContain('reconciliationOutputs');
  });

  it('does not use legacy sourceEventId payload hints as accepted provenance', () => {
    const objects = repoFile('packages/shared/src/objects/index.ts');
    const boards = repoFile('packages/shared/src/boards/index.ts');

    expect(objects).not.toContain('function sourceEventIdFromPayload');
    expect(boards).not.toContain('function sourceEventIdFromPayload');
    expect(objects).not.toContain('recordFromUnknown(value).sourceEventId');
    expect(boards).not.toContain('jsonObject(value).sourceEventId');
  });

  it('keeps direct-write source context inputs on raw-event terminology', () => {
    const objects = repoFile('packages/shared/src/objects/index.ts');
    const boards = repoFile('packages/shared/src/boards/index.ts');
    const signatures = [
      functionSignature(objects, 'buildObjectDirectWriteSourceContext'),
      functionSignature(boards, 'buildBoardDirectWriteSourceContext'),
    ];

    expect(signatures.every((signature) => signature.includes('sourceRawEventId: string'))).toBe(
      true,
    );
    expect(signatures.join('\n')).not.toContain('sourceEventId: string');
  });

  it('keeps old reconciliation writer paths out of application code', () => {
    const sources = scannedApplicationSources();

    expect(sources).not.toContain('createSuggestion(');
    expect(sources).not.toContain('artifactClusterMembers');
    expect(sources).not.toContain('artifact_cluster_members');
    expect(sources).not.toContain('.insert(artifactClusterMembers)');
    expect(sources).not.toContain('INSERT INTO artifact_cluster_members');
  });

  it('keeps every production raw-event writer on the reconciliation evidence path', () => {
    const writerFiles = rawEventWriterFiles();

    expect(writerFiles).toEqual([
      'apps/web/src/app/api/webhooks/ingest/route.ts',
      'apps/worker/src/workers/meetingFinalize.ts',
      'packages/shared/src/boards/index.ts',
      'packages/shared/src/calendar/raw-events.ts',
      'packages/shared/src/calendar/scope.ts',
      'packages/shared/src/documents/scope.ts',
      'packages/shared/src/integrations/event-writer.ts',
      'packages/shared/src/objects/index.ts',
      'packages/shared/src/reconciliation/mcp-capture.ts',
      'packages/shared/src/slack/dispatcher.ts',
      'packages/shared/src/team-scope.ts',
      'packages/shared/src/telegram/dispatcher.ts',
      'scripts/seed-dev.ts',
    ]);

    const missingNormalizer = writerFiles.filter((path) => {
      const source = repoFile(path);
      return ![
        'normalizeRawEventsToEvidence',
        'normalizeIntegrationEventsToEvidence',
        'normalizeCalendarRawEventIds',
        'reconciliationEvidence',
      ].some((needle) => source.includes(needle));
    });

    expect(missingNormalizer).toEqual([]);
  });

  it('keeps every production raw-event writer on a replay payload snapshot path', () => {
    const missingPayloadSnapshot = rawEventWriterFiles().filter((path) => {
      const source = repoFile(path);
      return ![
        'inlineSourceSnapshotMetadata',
        'source_payload_ref',
        'sourcePayloadRef',
        'payload_digest',
        'payloadDigest',
        'source_payload_digest',
        'buildCalendarSourcePayloadMetadata',
        'reconciliationEvidence',
      ].some((needle) => source.includes(needle));
    });

    expect(missingPayloadSnapshot).toEqual([]);
  });

  it('keeps canonical object and board history writes off legacy provenance columns', () => {
    const badEntityWrites = repoSourceFiles(APPLICATION_SOURCE_ROOTS)
      .flatMap((path) =>
        [
          ...statementSlices(readFileSync(path, 'utf8'), '.insert(entities)'),
          ...statementSlices(readFileSync(path, 'utf8'), '.update(entities)'),
        ].map((statement) => ({ path: relativeRepoPath(path), statement })),
      )
      .filter(({ statement }) =>
        [
          /sourceEventId:(?!\s*null\b)/,
          /agentSuggested:(?!\s*false\b)/,
          /\.set\([^)]*sourceEventId/s,
          /\.set\([^)]*agentSuggested/s,
        ].some((pattern) => pattern.test(statement)),
      )
      .map(({ path, statement }) => `${path}: ${statement.split('\n')[0]?.trim() ?? ''}`);

    const badHistoryWrites = repoSourceFiles(APPLICATION_SOURCE_ROOTS)
      .flatMap((path) =>
        [
          ...statementSlices(readFileSync(path, 'utf8'), '.insert(objectChanges)'),
          ...statementSlices(readFileSync(path, 'utf8'), '.update(objectChanges)'),
          ...statementSlices(readFileSync(path, 'utf8'), '.insert(boardItemChanges)'),
          ...statementSlices(readFileSync(path, 'utf8'), '.update(boardItemChanges)'),
        ].map((statement) => ({ path: relativeRepoPath(path), statement })),
      )
      .filter(({ statement }) =>
        [/sourceEventId:(?!\s*null\b)/, /\.set\([^)]*sourceEventId/s].some((pattern) =>
          pattern.test(statement),
        ),
      )
      .map(({ path, statement }) => `${path}: ${statement.split('\n')[0]?.trim() ?? ''}`);

    expect(badEntityWrites).toEqual([]);
    expect(badHistoryWrites).toEqual([]);
  });

  it('requires explicit visibility envelopes on association and output writers', () => {
    const requiredVisibilityFields = [
      'visibility:',
      'visibilityOwnerUserId',
      'visibilityUserIds',
      'visibilityFloor',
      'visibilityFloorOwnerUserId',
      'visibilityFloorUserIds',
    ];

    const missingVisibilityFields = repoSourceFiles(APPLICATION_SOURCE_ROOTS)
      .flatMap((path) =>
        [
          ...statementSlices(readFileSync(path, 'utf8'), '.insert(artifactEvidenceAssociations)'),
          ...statementSlices(readFileSync(path, 'utf8'), '.insert(reconciliationOutputs)'),
        ].map((statement) => ({ path: relativeRepoPath(path), statement })),
      )
      .flatMap(({ path, statement }) =>
        requiredVisibilityFields
          .filter((field) => !statement.includes(field))
          .map((field) => `${path}: missing ${field}`),
      );

    expect(missingVisibilityFields).toEqual([]);
  });

  it('requires output writers to carry replay payload refs alongside source refs', () => {
    const missingOutputPayloadRefs = repoSourceFiles(APPLICATION_SOURCE_ROOTS)
      .flatMap((path) =>
        statementSlices(readFileSync(path, 'utf8'), '.insert(reconciliationOutputs)').map(
          (statement) => ({ path: relativeRepoPath(path), statement }),
        ),
      )
      .filter(
        ({ statement }) =>
          statement.includes('sourceRefs') && !statement.includes('sourcePayloadRefs'),
      )
      .map(({ path, statement }) => `${path}: ${statement.split('\n')[0]?.trim() ?? ''}`);

    expect(missingOutputPayloadRefs).toEqual([]);
  });

  it('requires explicit replay, dedupe, and visibility fields on evidence writers', () => {
    const requiredEvidenceFields = [
      'sourcePayloadRef',
      'payloadDigest',
      'visibility:',
      'visibilityOwnerUserId',
      'visibilityUserIds',
      'replayState',
      'dedupeKey',
    ];

    const missingEvidenceFields = repoSourceFiles(APPLICATION_SOURCE_ROOTS)
      .flatMap((path) =>
        statementSlices(readFileSync(path, 'utf8'), '.insert(reconciliationEvidence)').map(
          (statement) => ({ path: relativeRepoPath(path), statement }),
        ),
      )
      .flatMap(({ path, statement }) =>
        requiredEvidenceFields
          .filter((field) => !statement.includes(field))
          .map((field) => `${path}: missing ${field}`),
      );

    expect(missingEvidenceFields).toEqual([]);
  });

  it('keeps approval projection table writes behind the suggestions projection module', () => {
    const approvalProjectionWriterFiles = repoSourceFiles(APPLICATION_SOURCE_ROOTS)
      .filter((path) => {
        const source = readFileSync(path, 'utf8');
        return [
          '.insert(agentSuggestions)',
          'INSERT INTO agent_suggestions',
          '.insert(agentSuggestionItems)',
          'INSERT INTO agent_suggestion_items',
          '.insert(agentSuggestionEvidence)',
          'INSERT INTO agent_suggestion_evidence',
        ].some((needle) => source.includes(needle));
      })
      .map(relativeRepoPath)
      .sort();

    expect(approvalProjectionWriterFiles).toEqual(['packages/shared/src/suggestions/index.ts']);
  });
});
