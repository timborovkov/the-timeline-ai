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
  return repoSourceFiles(['apps/web/src', 'apps/worker/src', 'packages/shared/src', 'scripts'])
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n');
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

  it('keeps old reconciliation writer paths out of application code', () => {
    const sources = scannedApplicationSources();

    expect(sources).not.toContain('createSuggestion(');
    expect(sources).not.toContain('.insert(artifactClusterMembers)');
    expect(sources).not.toContain('INSERT INTO artifact_cluster_members');
  });

  it('keeps approval projection table writes behind the suggestions projection module', () => {
    const approvalProjectionWriterFiles = repoSourceFiles([
      'apps/web/src',
      'apps/worker/src',
      'packages/shared/src',
      'scripts',
    ])
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
