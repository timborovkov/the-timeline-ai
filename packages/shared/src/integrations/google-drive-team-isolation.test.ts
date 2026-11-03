import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const SCAN_ROOTS = ['apps/web/src', 'apps/worker/src', 'packages/shared/src'];
const ALLOWED_DB_HELPER_FILES = new Set([
  'packages/shared/src/integrations/google-drive-capture.ts',
  'packages/shared/src/integrations/scope.ts',
]);
const ALLOWED_SNAPSHOT_TABLE_FILES = new Set([
  'packages/shared/src/integrations/google-drive-capture.ts',
  'packages/db/src/schema/integrations.ts',
]);

const UNSCOPED_DRIVE_DB_CALL =
  /\b(?:listDriveExtractCursors|forEachDriveExtractCursorPage|loadLatestDriveSnapshot|saveDriveSnapshot|deleteDriveSnapshotsForFile|deleteDriveSnapshotsForIntegration|linkedObjectForDriveSelection)\s*\(\s*(?:db|tx|input\.db)\b/;
const SNAPSHOT_TABLE = /\bgoogleDriveFileSnapshots\b/;
const UNSCOPED_LIB_LIST = /\bintegrationsLib\.listDriveExtractCursors\b/;

function isTestFile(path: string): boolean {
  return /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path);
}

function listTypeScriptSources(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      files.push(...listTypeScriptSources(path));
      continue;
    }
    if (['.ts', '.tsx'].includes(extname(path)) && !isTestFile(path)) files.push(path);
  }
  return files;
}

function driveTeamIsolationFindings(source: string, file: string): string[] {
  const findings: string[] = [];
  if (!ALLOWED_SNAPSHOT_TABLE_FILES.has(file) && SNAPSHOT_TABLE.test(source)) {
    findings.push(
      `${file} queries googleDriveFileSnapshots outside the team-scoped capture helper`,
    );
  }
  if (!ALLOWED_DB_HELPER_FILES.has(file) && UNSCOPED_DRIVE_DB_CALL.test(source)) {
    findings.push(`${file} reads Drive rows with a raw db handle; use withTeam(...).integrations`);
  }
  if (UNSCOPED_LIB_LIST.test(source)) {
    findings.push(
      `${file} lists Drive extract cursors without enumerating teams then withTeam scope.integrations`,
    );
  }
  return findings;
}

function scanProductionDriveAccess(): string[] {
  const findings: string[] = [];
  for (const scanRoot of SCAN_ROOTS) {
    for (const file of listTypeScriptSources(join(REPO_ROOT, scanRoot))) {
      findings.push(
        ...driveTeamIsolationFindings(readFileSync(file, 'utf8'), relative(REPO_ROOT, file)),
      );
    }
  }
  return findings;
}

describe('Drive withTeam isolation guard', () => {
  it('flags an unscoped extract-cursor list the way the janitor used to', () => {
    expect(
      driveTeamIsolationFindings(
        'const orphans = await integrationsLib.listDriveExtractCursors(input.db, { orphanOnly: true });',
        'apps/worker/src/workers/integrationSync.ts',
      ),
    ).toEqual([
      'apps/worker/src/workers/integrationSync.ts reads Drive rows with a raw db handle; use withTeam(...).integrations',
      'apps/worker/src/workers/integrationSync.ts lists Drive extract cursors without enumerating teams then withTeam scope.integrations',
    ]);
    expect(
      driveTeamIsolationFindings(
        'await listDriveExtractCursors(db, { orphanOnly: true });',
        'apps/worker/src/workers/janitor.ts',
      ),
    ).toEqual([
      'apps/worker/src/workers/janitor.ts reads Drive rows with a raw db handle; use withTeam(...).integrations',
    ]);
  });

  it('allows team-scoped wrappers and worker team discovery', () => {
    expect(
      driveTeamIsolationFindings(
        'return listDriveExtractCursors(db, { teamId });',
        'packages/shared/src/integrations/scope.ts',
      ),
    ).toEqual([]);
    expect(
      driveTeamIsolationFindings(
        'const teamIds = await integrationsLib.adminListTeamIdsWithDriveExtractCursors(input.db);',
        'apps/worker/src/workers/integrationSync.ts',
      ),
    ).toEqual([]);
    expect(
      driveTeamIsolationFindings(
        'const orphans = await scope.integrations.listDriveExtractCursors({ orphanOnly: true });',
        'apps/worker/src/workers/integrationSync.ts',
      ),
    ).toEqual([]);
  });

  it('keeps production Drive DB access on the withTeam integrations boundary', () => {
    expect(scanProductionDriveAccess()).toEqual([]);
  });

  it('routes event-writer workspace object lookup through withTeam objects', () => {
    const source = readFileSync(
      join(REPO_ROOT, 'packages/shared/src/integrations/event-writer.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/\.from\(\s*entities\s*\)/);
    expect(source).toContain('withTeam(');
    expect(source).toContain('.objects.listObjectsLinkedToIntegration');
  });

  it('forwards commentsSnapshot through the worker saveDriveSnapshot adapter', () => {
    const source = readFileSync(
      join(REPO_ROOT, 'apps/worker/src/workers/integrationSync.ts'),
      'utf8',
    );
    const adapter = /saveDriveSnapshot\(input\) \{[\s\S]*?\n      \},/.exec(source)?.[0];
    expect(adapter).toBeDefined();
    expect(adapter).toContain('commentsSnapshot');
    expect(adapter).toContain('snapshotLocate');
    expect(source).toContain('deleteDriveSnapshotsForFile');
  });
});
