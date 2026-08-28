import { describe, expect, it } from 'vitest';

import {
  parseErrorReference,
  parseSupportSurface,
  supportRequestHref,
  supportSurfaceForPath,
  supportSurfacePath,
} from '@/lib/support-context';

describe('support context', () => {
  it.each([
    ['/app', 'app_home'],
    ['/app/timeline', 'timeline'],
    ['/app/boards/board-secret-id', 'board_detail'],
    ['/app/objects/object-secret-id', 'object_detail'],
    ['/app/entities/object-secret-id', 'object_detail'],
    ['/app/documents/document-secret-id', 'document_detail'],
    ['/app/documents/captured', 'documents'],
    ['/app/meetings/meeting-secret-id', 'meeting_detail'],
    ['/app/team/integrations/audit', 'team_integration_audit'],
    ['/app/team/reconciliation/clusters/cluster-secret-id', 'team_reconciliation'],
  ])('collapses %s to the allowlisted %s surface', (pathname, surface) => {
    expect(supportSurfaceForPath(pathname)).toBe(surface);
  });

  it('fails closed for public and unknown private paths', () => {
    expect(supportSurfaceForPath('/help/support')).toBeNull();
    expect(supportSurfaceForPath('/app/unknown/customer-secret')).toBeNull();
    expect(parseSupportSurface('team/integrations?token=secret')).toBeNull();
    expect(supportRequestHref('/help/support', 'public-error-reference')).toBe('/help/support');
  });

  it('builds a support URL without raw paths, queries, or dynamic identifiers', () => {
    expect(supportRequestHref('/app/boards/board-secret-id?token=secret', 'safe-reference')).toBe(
      '/help/support?surface=board_detail&error=safe-reference',
    );
    expect(supportRequestHref('/app/boards/board-secret-id', 'safe-reference')).toBe(
      '/help/support?surface=board_detail&error=safe-reference',
    );
    expect(supportSurfacePath('board_detail')).toBe('/app/boards/:id');
  });

  it('accepts bounded Sentry references and rejects arbitrary context', () => {
    expect(parseErrorReference(' error-reference:123 ')).toBe('error-reference:123');
    expect(parseErrorReference('reference?token=secret')).toBeNull();
    expect(parseErrorReference('x'.repeat(129))).toBeNull();
  });
});
