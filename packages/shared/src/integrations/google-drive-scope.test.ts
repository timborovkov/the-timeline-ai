import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import {
  createDriveAncestryCache,
  driveAncestryIds,
  driveFileCoverage,
  driveFileScopeHint,
  driveMostSpecificSelectedAncestor,
  driveScopeFromSelections,
  pickMostSpecificDriveAncestor,
  resolveDriveFileMembership,
} from '#src/integrations/google-drive-scope.js';

describe('driveFileScopeHint', () => {
  it('matches a specifically selected file without reading parents', () => {
    const scope = driveScopeFromSelections([{ kind: 'drive.file', externalId: 'doc-1' }]);
    expect(driveFileScopeHint({ fileId: 'doc-1', parents: ['other'], scope })).toBe('in');
    expect(driveFileScopeHint({ fileId: 'doc-2', parents: ['other'], scope })).toBe('out');
  });

  it('matches an immediate selected folder or shared drive from payload ids only', () => {
    const scope = driveScopeFromSelections([
      { kind: 'drive.folder', externalId: 'folder-1' },
      { kind: 'drive.shared_drive', externalId: 'drive-9' },
    ]);
    expect(driveFileScopeHint({ fileId: 'a', parents: ['folder-1'], scope })).toBe('in');
    expect(driveFileScopeHint({ fileId: 'b', driveId: 'drive-9', scope })).toBe('in');
    expect(driveFileScopeHint({ fileId: 'c', parents: ['nested'], scope })).toBe('unknown');
  });

  it('keeps a dropped explicit file in remaining folder or shared-drive scope', () => {
    const remainingFolder = driveScopeFromSelections([
      { kind: 'drive.folder', externalId: 'folder-1' },
    ]);
    expect(
      driveFileScopeHint({ fileId: 'doc-1', parents: ['folder-1'], scope: remainingFolder }),
    ).toBe('in');
    expect(driveFileScopeHint({ fileId: 'doc-1', scope: remainingFolder })).toBe('unknown');
    const remainingDrive = driveScopeFromSelections([
      { kind: 'drive.shared_drive', externalId: 'drive-9' },
    ]);
    expect(driveFileScopeHint({ fileId: 'doc-1', scope: remainingDrive })).toBe('unknown');
    expect(driveFileScopeHint({ fileId: 'doc-1', driveId: 'drive-9', scope: remainingDrive })).toBe(
      'in',
    );
  });

  it('treats My Drive root as in-scope only when the parent is root', () => {
    const scope = driveScopeFromSelections([{ kind: 'drive.folder', externalId: 'root' }]);
    expect(driveFileScopeHint({ fileId: 'mine', parents: ['root'], scope })).toBe('in');
    expect(driveFileScopeHint({ fileId: 'shared-with-me', parents: ['other-user'], scope })).toBe(
      'unknown',
    );
  });

  it('matches the resolved My Drive folder id after it is added to the folder set', () => {
    const scope = driveScopeFromSelections([{ kind: 'drive.folder', externalId: 'root' }]);
    scope.folders.add('0AMK-my-drive');
    expect(driveFileScopeHint({ fileId: 'mine', parents: ['0AMK-my-drive'], scope })).toBe('in');
  });
});

describe('Drive ancestry precedence and coverage matrix', () => {
  const folderA = driveScopeFromSelections([{ kind: 'drive.folder', externalId: 'folder-a' }]);
  const folderB = driveScopeFromSelections([{ kind: 'drive.folder', externalId: 'folder-b' }]);
  const bothFolders = driveScopeFromSelections([
    { kind: 'drive.folder', externalId: 'folder-a' },
    { kind: 'drive.folder', externalId: 'folder-b' },
  ]);
  const sharedDrive = driveScopeFromSelections([
    { kind: 'drive.shared_drive', externalId: 'drive-9' },
  ]);
  const folderAndDrive = driveScopeFromSelections([
    { kind: 'drive.folder', externalId: 'folder-a' },
    { kind: 'drive.shared_drive', externalId: 'drive-9' },
  ]);
  const fileOnly = driveScopeFromSelections([{ kind: 'drive.file', externalId: 'picked' }]);

  const cases: {
    name: string;
    fileId: string;
    scope: ReturnType<typeof driveScopeFromSelections>;
    parents?: string[];
    driveId?: string;
    matchedAncestorId?: string;
    candidates?: string[];
    coverage: 'in' | 'out' | 'unknown';
    ancestor: string | null;
  }[] = [
    {
      name: 'explicit file',
      fileId: 'picked',
      scope: fileOnly,
      parents: ['other'],
      coverage: 'in',
      ancestor: 'picked',
    },
    {
      name: 'immediate folder child',
      fileId: 'doc',
      scope: folderA,
      parents: ['folder-a'],
      coverage: 'in',
      ancestor: 'folder-a',
    },
    {
      name: 'nested folder needs walk',
      fileId: 'doc',
      scope: folderA,
      parents: ['nested'],
      coverage: 'unknown',
      ancestor: null,
    },
    {
      name: 'shared drive payload',
      fileId: 'doc',
      scope: sharedDrive,
      parents: ['nested'],
      driveId: 'drive-9',
      coverage: 'in',
      ancestor: 'drive-9',
    },
    {
      name: 'folder beats shared drive on payload',
      fileId: 'doc',
      scope: folderAndDrive,
      parents: ['folder-a'],
      driveId: 'drive-9',
      coverage: 'in',
      ancestor: 'folder-a',
    },
    {
      name: 'folder beats shared drive even when drive is listed first',
      fileId: 'doc',
      scope: folderAndDrive,
      candidates: ['doc', 'drive-9', 'folder-a'],
      coverage: 'in',
      ancestor: 'folder-a',
    },
    {
      name: 'remove unrelated folder leaves sibling uncovered',
      fileId: 'doc',
      scope: folderB,
      candidates: ['doc', 'nested', 'folder-a'],
      matchedAncestorId: 'folder-a',
      coverage: 'out',
      ancestor: null,
    },
    {
      name: 'remove inner folder keeps shared-drive coverage',
      fileId: 'doc',
      scope: sharedDrive,
      candidates: ['doc', 'nested', 'folder-a', 'drive-9'],
      driveId: 'drive-9',
      coverage: 'in',
      ancestor: 'drive-9',
    },
    {
      name: 'remove shared drive keeps inner folder',
      fileId: 'doc',
      scope: folderA,
      candidates: ['doc', 'nested', 'folder-a', 'drive-9'],
      coverage: 'in',
      ancestor: 'folder-a',
    },
    {
      name: 'two folders, file only in a',
      fileId: 'doc',
      scope: bothFolders,
      candidates: ['doc', 'folder-a'],
      coverage: 'in',
      ancestor: 'folder-a',
    },
    {
      name: 'unstamped nested with remaining folder stays unknown',
      fileId: 'doc',
      scope: folderB,
      coverage: 'unknown',
      ancestor: null,
    },
    {
      name: 'no remaining containers uncovers unstamped files',
      fileId: 'doc',
      scope: driveScopeFromSelections([]),
      coverage: 'out',
      ancestor: null,
    },
    {
      name: 'explicit file beats overlapping folder and shared drive',
      fileId: 'picked',
      scope: driveScopeFromSelections([
        { kind: 'drive.file', externalId: 'picked' },
        { kind: 'drive.folder', externalId: 'folder-a' },
        { kind: 'drive.shared_drive', externalId: 'drive-9' },
      ]),
      candidates: ['drive-9', 'folder-a', 'picked'],
      coverage: 'in',
      ancestor: 'picked',
    },
    {
      name: 'unlink explicit file without remaining coverage',
      fileId: 'picked',
      scope: folderB,
      candidates: ['picked'],
      coverage: 'out',
      ancestor: null,
    },
    {
      name: 'unlink file still covered by remaining folder',
      fileId: 'picked',
      scope: folderA,
      parents: ['folder-a'],
      coverage: 'in',
      ancestor: 'folder-a',
    },
    {
      name: 'nested selected folder on the parent list',
      fileId: 'doc',
      scope: driveScopeFromSelections([{ kind: 'drive.folder', externalId: 'nested' }]),
      parents: ['nested'],
      driveId: 'drive-9',
      coverage: 'in',
      ancestor: 'nested',
    },
    {
      name: 'remove nested folder keeps remaining outer folder when stamped',
      fileId: 'doc',
      scope: folderA,
      candidates: ['doc', 'nested', 'folder-a'],
      matchedAncestorId: 'nested',
      coverage: 'in',
      ancestor: 'folder-a',
    },
  ];

  it('picks the most specific selected ancestor and coverage per remaining selection', () => {
    for (const testCase of cases) {
      const coverage = driveFileCoverage({
        fileId: testCase.fileId,
        scope: testCase.scope,
        ...(testCase.parents ? { parents: testCase.parents } : {}),
        ...(testCase.driveId ? { driveId: testCase.driveId } : {}),
        ...(testCase.matchedAncestorId ? { matchedAncestorId: testCase.matchedAncestorId } : {}),
        ...(testCase.candidates ? { candidates: testCase.candidates } : {}),
      });
      const ancestor = driveMostSpecificSelectedAncestor({
        fileId: testCase.fileId,
        scope: testCase.scope,
        ...(testCase.parents ? { parents: testCase.parents } : {}),
        ...(testCase.driveId ? { driveId: testCase.driveId } : {}),
        ...(testCase.matchedAncestorId ? { matchedAncestorId: testCase.matchedAncestorId } : {}),
        ...(testCase.candidates ? { candidates: testCase.candidates } : {}),
      });
      if (coverage !== testCase.coverage || ancestor !== testCase.ancestor) {
        throw new Error(
          `${testCase.name}: expected coverage=${testCase.coverage} ancestor=${String(testCase.ancestor)}, got coverage=${coverage} ancestor=${String(ancestor)}`,
        );
      }
    }
  });

  it('ranks file over folder over shared drive regardless of list order', () => {
    expect(
      pickMostSpecificDriveAncestor(['drive-9', 'folder-a', 'picked'], (id) => {
        if (id === 'picked') return 'file';
        if (id === 'folder-a') return 'folder';
        if (id === 'drive-9') return 'shared_drive';
        return null;
      }),
    ).toBe('picked');
    expect(
      pickMostSpecificDriveAncestor(['drive-9', 'folder-a'], (id) => {
        if (id === 'folder-a') return 'folder';
        if (id === 'drive-9') return 'shared_drive';
        return null;
      }),
    ).toBe('folder-a');
  });

  it('puts immediate parents before shared drive in ancestry', () => {
    expect(
      driveAncestryIds({
        fileId: 'nested-file',
        parentIds: ['nested'],
        matchedAncestorId: 'folder-a',
        driveId: 'drive-9',
      }),
    ).toEqual(['nested-file', 'nested', 'folder-a', 'drive-9']);
  });
});

describe('resolveDriveFileMembership', () => {
  it('caches parent ids and selected ancestors, never an early negative', async () => {
    const scope = driveScopeFromSelections([{ kind: 'drive.folder', externalId: 'selected' }]);
    const cache = createDriveAncestryCache();
    const fetched: string[] = [];
    const getParents = (folderId: string) => {
      fetched.push(folderId);
      if (folderId === 'nested') return Promise.resolve(['selected']);
      return Promise.resolve(null);
    };

    const first = await resolveDriveFileMembership({
      fileId: 'file-a',
      parents: ['nested'],
      scope,
      cache,
      getParents,
    });
    const second = await resolveDriveFileMembership({
      fileId: 'file-b',
      parents: ['nested'],
      scope,
      cache,
      getParents,
    });

    expect(first).toEqual({ inScope: true, matchedAncestorId: 'selected' });
    expect(second).toEqual({ inScope: true, matchedAncestorId: 'selected' });
    expect(fetched).toEqual(['nested']);
    expect(cache.parents.get('nested')).toEqual(['selected']);
    expect(cache.selectedAncestorById.get('nested')).toBe('selected');
    expect(cache.parents.has('file-a')).toBe(false);
  });

  it('reuses cached parent metadata for a later out-of-scope sibling without storing false', async () => {
    const scope = driveScopeFromSelections([{ kind: 'drive.folder', externalId: 'other-tree' }]);
    const cache = createDriveAncestryCache();
    const fetched: string[] = [];
    const getParents = (folderId: string) => {
      fetched.push(folderId);
      if (folderId === 'nested') return Promise.resolve(['outside']);
      if (folderId === 'outside') return Promise.resolve(null);
      return Promise.resolve(null);
    };

    const first = await resolveDriveFileMembership({
      fileId: 'file-a',
      parents: ['nested'],
      scope,
      cache,
      getParents,
    });
    const second = await resolveDriveFileMembership({
      fileId: 'file-b',
      parents: ['nested'],
      scope,
      cache,
      getParents,
    });

    expect(first.inScope).toBe(false);
    expect(second.inScope).toBe(false);
    expect(fetched).toEqual(['nested', 'outside']);
    expect(cache.selectedAncestorById.size).toBe(0);
  });

  it('resolves a nested folder inside a selected shared drive instead of skipping the parent walk', async () => {
    const scope = driveScopeFromSelections([
      { kind: 'drive.folder', externalId: 'folder-a' },
      { kind: 'drive.shared_drive', externalId: 'drive-9' },
    ]);
    const cache = createDriveAncestryCache();
    const fetched: string[] = [];
    const getParents = (folderId: string) => {
      fetched.push(folderId);
      if (folderId === 'nested') return Promise.resolve(['folder-a']);
      if (folderId === 'folder-a') return Promise.resolve(['drive-9']);
      return Promise.resolve(null);
    };

    const nested = await resolveDriveFileMembership({
      fileId: 'nested-file',
      parents: ['nested'],
      driveId: 'drive-9',
      scope,
      cache,
      getParents,
    });
    const sibling = await resolveDriveFileMembership({
      fileId: 'sibling-file',
      parents: ['other-tree'],
      driveId: 'drive-9',
      scope,
      cache,
      getParents: (folderId) => {
        fetched.push(folderId);
        if (folderId === 'other-tree') return Promise.resolve(['drive-9']);
        return Promise.resolve(null);
      },
    });

    expect(nested).toEqual({ inScope: true, matchedAncestorId: 'folder-a' });
    expect(sibling).toEqual({ inScope: true, matchedAncestorId: 'drive-9' });
    expect(fetched).toEqual(['nested', 'other-tree']);
  });

  it('walks past a shared-drive parent to a selected folder on another ancestor path', async () => {
    const scope = driveScopeFromSelections([
      { kind: 'drive.folder', externalId: 'folder-a' },
      { kind: 'drive.shared_drive', externalId: 'drive-9' },
    ]);
    const cache = createDriveAncestryCache();
    const fetched: string[] = [];
    const nested = await resolveDriveFileMembership({
      fileId: 'nested-file',
      parents: ['drive-9', 'nested'],
      driveId: 'drive-9',
      scope,
      cache,
      getParents: (folderId) => {
        fetched.push(folderId);
        if (folderId === 'nested') return Promise.resolve(['folder-a']);
        if (folderId === 'folder-a') return Promise.resolve(['drive-9']);
        return Promise.resolve(null);
      },
    });

    expect(nested).toEqual({ inScope: true, matchedAncestorId: 'folder-a' });
    expect(fetched).toEqual(['nested']);
  });
});
