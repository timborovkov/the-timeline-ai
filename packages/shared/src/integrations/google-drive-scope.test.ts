import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import {
  createDriveAncestryCache,
  driveAncestorKindFromSelectionKind,
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

    expect(first).toMatchObject({ inScope: true, matchedAncestorId: 'selected' });
    expect(second).toMatchObject({ inScope: true, matchedAncestorId: 'selected' });
    expect(fetched).toEqual(['nested', 'selected']);
    expect(cache.parents.get('nested')).toEqual(['selected']);
    expect(cache.parents.get('selected')).toBeNull();
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

    expect(nested).toMatchObject({ inScope: true, matchedAncestorId: 'folder-a' });
    expect(sibling).toMatchObject({ inScope: true, matchedAncestorId: 'drive-9' });
    expect(fetched).toEqual(['nested', 'folder-a', 'other-tree']);
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

    expect(nested).toMatchObject({ inScope: true, matchedAncestorId: 'folder-a' });
    expect(fetched).toEqual(['nested', 'folder-a']);
  });

  it('keeps walking past an inner selected folder so an outer selected ancestor stays on the path', async () => {
    const scope = driveScopeFromSelections([
      { kind: 'drive.folder', externalId: 'inner' },
      { kind: 'drive.folder', externalId: 'outer' },
    ]);
    const cache = createDriveAncestryCache();
    const fetched: string[] = [];
    const nested = await resolveDriveFileMembership({
      fileId: 'doc',
      parents: ['nested'],
      scope,
      cache,
      getParents: (folderId) => {
        fetched.push(folderId);
        if (folderId === 'nested') return Promise.resolve(['inner']);
        if (folderId === 'inner') return Promise.resolve(['outer']);
        if (folderId === 'outer') return Promise.resolve(['drive-9']);
        return Promise.resolve(null);
      },
    });

    expect(nested.inScope).toBe(true);
    expect(nested.matchedAncestorId).toBe('inner');
    expect(nested.ancestryIds).toEqual(
      expect.arrayContaining(['doc', 'nested', 'inner', 'outer', 'drive-9']),
    );
    expect(fetched).toEqual(['nested', 'inner', 'outer', 'drive-9']);

    const again = await resolveDriveFileMembership({
      fileId: 'doc-2',
      parents: ['nested'],
      scope,
      cache,
      getParents: (folderId) => {
        fetched.push(folderId);
        return Promise.resolve(null);
      },
    });
    expect(again.matchedAncestorId).toBe('inner');
    expect(again.ancestryIds).toEqual(expect.arrayContaining(['outer']));
    expect(fetched).toEqual(['nested', 'inner', 'outer', 'drive-9']);
  });

  it('walks past an immediate selected parent so an outer selected ancestor stays on the path', async () => {
    const scope = driveScopeFromSelections([
      { kind: 'drive.folder', externalId: 'inner' },
      { kind: 'drive.folder', externalId: 'outer' },
    ]);
    const cache = createDriveAncestryCache();
    const fetched: string[] = [];
    const nested = await resolveDriveFileMembership({
      fileId: 'doc',
      parents: ['inner'],
      scope,
      cache,
      getParents: (folderId) => {
        fetched.push(folderId);
        if (folderId === 'inner') return Promise.resolve(['outer']);
        if (folderId === 'outer') return Promise.resolve(null);
        return Promise.resolve(null);
      },
    });

    expect(nested).toMatchObject({ inScope: true, matchedAncestorId: 'inner' });
    expect(nested.ancestryIds).toEqual(expect.arrayContaining(['doc', 'inner', 'outer']));
    expect(fetched).toEqual(['inner', 'outer']);
  });

  it('walks ancestors of an explicit unlinked file so a nested linked folder stays on the path', async () => {
    const scope = driveScopeFromSelections([
      { kind: 'drive.file', externalId: 'doc' },
      { kind: 'drive.folder', externalId: 'outer' },
    ]);
    const cache = createDriveAncestryCache();
    const fetched: string[] = [];
    const membership = await resolveDriveFileMembership({
      fileId: 'doc',
      parents: ['nested'],
      scope,
      cache,
      getParents: (folderId) => {
        fetched.push(folderId);
        if (folderId === 'nested') return Promise.resolve(['outer']);
        return Promise.resolve(null);
      },
    });

    expect(membership).toMatchObject({ inScope: true, matchedAncestorId: 'doc' });
    expect(membership.ancestryIds).toEqual(expect.arrayContaining(['doc', 'nested', 'outer']));
    expect(fetched).toEqual(['nested', 'outer']);
  });
});

describe('Drive membership and inherited-link resolver matrix', () => {
  const tree: Record<string, string[] | null> = {
    nested: ['inner'],
    inner: ['outer'],
    outer: ['drive-9'],
    'folder-a': ['drive-9'],
    'folder-b': ['root'],
    'other-tree': ['drive-9'],
    'shared-folder': ['drive-9'],
    clients: ['0AMK-my-drive'],
    '0AMK-my-drive': ['root'],
    'drive-9': null,
    root: null,
  };
  const OBJECT_A = 'object-a';
  const OBJECT_B = 'object-b';

  const cases: {
    name: string;
    selections: { kind: string; externalId: string; linked?: string | null }[];
    fileId: string;
    parents?: string[];
    driveId?: string;
    inScope: boolean;
    matchedAncestorId: string | null;
    ancestryContains?: string[];
    ancestryOmits?: string[];
    fetched?: string[];
    inheritedFrom: string | null;
  }[] = [
    {
      name: 'explicit unlinked file under nested subfolder of linked folder',
      selections: [
        { kind: 'drive.file', externalId: 'doc' },
        { kind: 'drive.folder', externalId: 'outer', linked: OBJECT_A },
      ],
      fileId: 'doc',
      parents: ['nested'],
      inScope: true,
      matchedAncestorId: 'doc',
      ancestryContains: ['doc', 'nested', 'outer'],
      inheritedFrom: 'outer',
    },
    {
      name: 'explicit linked file under nested linked folder keeps the file object',
      selections: [
        { kind: 'drive.file', externalId: 'doc', linked: OBJECT_B },
        { kind: 'drive.folder', externalId: 'outer', linked: OBJECT_A },
      ],
      fileId: 'doc',
      parents: ['nested'],
      inScope: true,
      matchedAncestorId: 'doc',
      ancestryContains: ['outer'],
      inheritedFrom: 'doc',
    },
    {
      name: 'inherited file under nested of linked folder',
      selections: [{ kind: 'drive.folder', externalId: 'outer', linked: OBJECT_A }],
      fileId: 'doc',
      parents: ['nested'],
      inScope: true,
      matchedAncestorId: 'outer',
      ancestryContains: ['doc', 'nested', 'inner', 'outer'],
      inheritedFrom: 'outer',
    },
    {
      name: 'explicit file with no selected containers does not walk',
      selections: [{ kind: 'drive.file', externalId: 'doc' }],
      fileId: 'doc',
      parents: ['nested'],
      inScope: true,
      matchedAncestorId: 'doc',
      ancestryContains: ['doc', 'nested'],
      ancestryOmits: ['outer'],
      fetched: [],
      inheritedFrom: null,
    },
    {
      name: 'inner unlinked selected folder does not hide outer linked folder',
      selections: [
        { kind: 'drive.folder', externalId: 'inner' },
        { kind: 'drive.folder', externalId: 'outer', linked: OBJECT_A },
      ],
      fileId: 'doc',
      parents: ['nested'],
      inScope: true,
      matchedAncestorId: 'inner',
      ancestryContains: ['outer'],
      inheritedFrom: 'outer',
    },
    {
      name: 'explicit unlinked file, inner unlinked folder, outer linked folder',
      selections: [
        { kind: 'drive.file', externalId: 'doc' },
        { kind: 'drive.folder', externalId: 'inner' },
        { kind: 'drive.folder', externalId: 'outer', linked: OBJECT_A },
      ],
      fileId: 'doc',
      parents: ['nested'],
      inScope: true,
      matchedAncestorId: 'doc',
      ancestryContains: ['inner', 'outer'],
      inheritedFrom: 'outer',
    },
    {
      name: 'inherited file under linked shared drive via nested folder',
      selections: [{ kind: 'drive.shared_drive', externalId: 'drive-9', linked: OBJECT_A }],
      fileId: 'doc',
      parents: ['nested'],
      driveId: 'drive-9',
      inScope: true,
      matchedAncestorId: 'drive-9',
      ancestryContains: ['drive-9'],
      inheritedFrom: 'drive-9',
    },
    {
      name: 'folder beats shared drive for inherited nested file',
      selections: [
        { kind: 'drive.folder', externalId: 'outer', linked: OBJECT_B },
        { kind: 'drive.shared_drive', externalId: 'drive-9', linked: OBJECT_A },
      ],
      fileId: 'doc',
      parents: ['nested'],
      driveId: 'drive-9',
      inScope: true,
      matchedAncestorId: 'outer',
      inheritedFrom: 'outer',
    },
    {
      name: 'explicit unlinked file under nested folder of linked shared drive',
      selections: [
        { kind: 'drive.file', externalId: 'doc' },
        { kind: 'drive.shared_drive', externalId: 'drive-9', linked: OBJECT_A },
      ],
      fileId: 'doc',
      parents: ['nested'],
      driveId: 'drive-9',
      inScope: true,
      matchedAncestorId: 'doc',
      ancestryContains: ['drive-9'],
      inheritedFrom: 'drive-9',
    },
    {
      name: 'explicit linked file beats linked shared drive',
      selections: [
        { kind: 'drive.file', externalId: 'doc', linked: OBJECT_B },
        { kind: 'drive.shared_drive', externalId: 'drive-9', linked: OBJECT_A },
      ],
      fileId: 'doc',
      parents: ['nested'],
      driveId: 'drive-9',
      inScope: true,
      matchedAncestorId: 'doc',
      inheritedFrom: 'doc',
    },
    {
      name: 'out of scope nested file does not inherit a sibling tree',
      selections: [{ kind: 'drive.folder', externalId: 'folder-b', linked: OBJECT_A }],
      fileId: 'doc',
      parents: ['nested'],
      inScope: false,
      matchedAncestorId: null,
      ancestryOmits: ['folder-b'],
      inheritedFrom: null,
    },
    {
      name: 'move from linked folder A to linked folder B',
      selections: [
        { kind: 'drive.folder', externalId: 'folder-a', linked: OBJECT_A },
        { kind: 'drive.folder', externalId: 'folder-b', linked: OBJECT_B },
      ],
      fileId: 'doc',
      parents: ['folder-b'],
      inScope: true,
      matchedAncestorId: 'folder-b',
      ancestryContains: ['folder-b'],
      ancestryOmits: ['folder-a'],
      inheritedFrom: 'folder-b',
    },
    {
      name: 'move explicit unlinked file from folder A into nested of folder B',
      selections: [
        { kind: 'drive.file', externalId: 'doc' },
        { kind: 'drive.folder', externalId: 'folder-a', linked: OBJECT_A },
        { kind: 'drive.folder', externalId: 'outer', linked: OBJECT_B },
      ],
      fileId: 'doc',
      parents: ['nested'],
      inScope: true,
      matchedAncestorId: 'doc',
      ancestryContains: ['outer'],
      inheritedFrom: 'outer',
    },
    {
      name: 'explicit unlinked file immediate child of linked folder',
      selections: [
        { kind: 'drive.file', externalId: 'doc' },
        { kind: 'drive.folder', externalId: 'outer', linked: OBJECT_A },
      ],
      fileId: 'doc',
      parents: ['outer'],
      inScope: true,
      matchedAncestorId: 'doc',
      ancestryContains: ['doc', 'outer'],
      inheritedFrom: 'outer',
    },
    {
      name: 'My Drive root linked, explicit unlinked nested file',
      selections: [
        { kind: 'drive.file', externalId: 'doc' },
        { kind: 'drive.folder', externalId: 'root', linked: OBJECT_A },
      ],
      fileId: 'doc',
      parents: ['clients'],
      inScope: true,
      matchedAncestorId: 'doc',
      ancestryContains: ['root'],
      inheritedFrom: 'root',
    },
    {
      name: 'shared-drive parent does not skip selected folder on other path',
      selections: [
        { kind: 'drive.folder', externalId: 'outer', linked: OBJECT_B },
        { kind: 'drive.shared_drive', externalId: 'drive-9', linked: OBJECT_A },
      ],
      fileId: 'doc',
      parents: ['drive-9', 'nested'],
      driveId: 'drive-9',
      inScope: true,
      matchedAncestorId: 'outer',
      inheritedFrom: 'outer',
    },
    {
      name: 'unlinked explicit file and unlinked folder inherit nothing',
      selections: [
        { kind: 'drive.file', externalId: 'doc' },
        { kind: 'drive.folder', externalId: 'outer' },
      ],
      fileId: 'doc',
      parents: ['nested'],
      inScope: true,
      matchedAncestorId: 'doc',
      ancestryContains: ['outer'],
      inheritedFrom: null,
    },
    {
      name: 'sibling linked folder does not steal a file under a different tree',
      selections: [
        { kind: 'drive.folder', externalId: 'folder-b', linked: OBJECT_B },
        { kind: 'drive.folder', externalId: 'outer', linked: OBJECT_A },
      ],
      fileId: 'doc',
      parents: ['nested'],
      inScope: true,
      matchedAncestorId: 'outer',
      inheritedFrom: 'outer',
    },
    {
      name: 'three-deep nested folders, only outermost linked',
      selections: [{ kind: 'drive.folder', externalId: 'outer', linked: OBJECT_A }],
      fileId: 'doc',
      parents: ['nested'],
      inScope: true,
      matchedAncestorId: 'outer',
      ancestryContains: ['nested', 'inner', 'outer'],
      inheritedFrom: 'outer',
    },
    {
      name: 'move inherited file from shared drive into linked folder',
      selections: [
        { kind: 'drive.folder', externalId: 'folder-b', linked: OBJECT_B },
        { kind: 'drive.shared_drive', externalId: 'drive-9', linked: OBJECT_A },
      ],
      fileId: 'doc',
      parents: ['folder-b'],
      driveId: 'drive-9',
      inScope: true,
      matchedAncestorId: 'folder-b',
      inheritedFrom: 'folder-b',
    },
    {
      name: 'explicit unlinked file moved under linked shared drive',
      selections: [
        { kind: 'drive.file', externalId: 'doc' },
        { kind: 'drive.folder', externalId: 'folder-b', linked: OBJECT_B },
        { kind: 'drive.shared_drive', externalId: 'drive-9', linked: OBJECT_A },
      ],
      fileId: 'doc',
      parents: ['shared-folder'],
      driveId: 'drive-9',
      inScope: true,
      matchedAncestorId: 'doc',
      ancestryContains: ['drive-9'],
      ancestryOmits: ['folder-b'],
      inheritedFrom: 'drive-9',
    },
  ];

  it('walks ancestry and picks the nearest linked selected ancestor', async () => {
    for (const testCase of cases) {
      const scope = driveScopeFromSelections(testCase.selections);
      const fetched: string[] = [];
      const membership = await resolveDriveFileMembership({
        fileId: testCase.fileId,
        scope,
        cache: createDriveAncestryCache(),
        getParents: (folderId) => {
          fetched.push(folderId);
          return Promise.resolve(folderId in tree ? (tree[folderId] ?? null) : null);
        },
        ...(testCase.parents ? { parents: testCase.parents } : {}),
        ...(testCase.driveId ? { driveId: testCase.driveId } : {}),
      });
      const linkedById = new Map(
        testCase.selections
          .filter(
            (selection) => typeof selection.linked === 'string' && selection.linked.length > 0,
          )
          .map((selection) => [selection.externalId, selection]),
      );
      const inheritedFrom = pickMostSpecificDriveAncestor(membership.ancestryIds, (id) => {
        const hit = linkedById.get(id);
        return hit ? driveAncestorKindFromSelectionKind(hit.kind) : null;
      });
      const problems: string[] = [];
      if (membership.inScope !== testCase.inScope) {
        problems.push(`inScope=${String(membership.inScope)}`);
      }
      if (membership.matchedAncestorId !== testCase.matchedAncestorId) {
        problems.push(`matchedAncestorId=${String(membership.matchedAncestorId)}`);
      }
      if (inheritedFrom !== testCase.inheritedFrom) {
        problems.push(`inheritedFrom=${String(inheritedFrom)}`);
      }
      for (const id of testCase.ancestryContains ?? []) {
        if (!membership.ancestryIds.includes(id)) problems.push(`missing ancestry ${id}`);
      }
      for (const id of testCase.ancestryOmits ?? []) {
        if (membership.ancestryIds.includes(id)) problems.push(`unexpected ancestry ${id}`);
      }
      if (testCase.fetched && fetched.join(',') !== testCase.fetched.join(',')) {
        problems.push(`fetched=${fetched.join(',')}`);
      }
      if (problems.length > 0) {
        throw new Error(
          `${testCase.name}: ${problems.join('; ')} ancestry=${membership.ancestryIds.join(',')}`,
        );
      }
    }
  });
});
