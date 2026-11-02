import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import {
  driveFileScopeHint,
  driveScopeFromSelections,
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
