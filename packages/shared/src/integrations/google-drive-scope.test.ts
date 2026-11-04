import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import {
  createDriveAncestryCache,
  driveFileScopeHint,
  driveScopeFromSelections,
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
});
