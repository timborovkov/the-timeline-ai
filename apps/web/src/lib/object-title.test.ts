import { describe, expect, it } from 'vitest';

import { displayObjectTitle } from '@/lib/object-title';

describe('displayObjectTitle', () => {
  it('prefers explicit display titles from integration metadata', () => {
    expect(
      displayObjectTitle({
        canonicalName: 'timborovkov/the-timeline-ai#202: Add cursor pagination',
        metadata: {
          integration_provider: 'github',
          display_title: 'the-timeline-ai: Add cursor pagination',
        },
      }),
    ).toBe('the-timeline-ai: Add cursor pagination');
  });

  it('cleans legacy GitHub PR and issue canonical names', () => {
    expect(
      displayObjectTitle({
        canonicalName: 'timborovkov/the-timeline-ai#202: Add cursor pagination',
        metadata: {
          integration_provider: 'github',
          integration_external_id: 'timborovkov/the-timeline-ai#202',
        },
      }),
    ).toBe('the-timeline-ai: Add cursor pagination');

    expect(
      displayObjectTitle({
        canonicalName: 'timborovkov/audit-ai#19: Sync invoices',
        metadata: {
          integration_provider: 'github',
          integration_external_id: 'timborovkov/audit-ai#issue:19',
        },
      }),
    ).toBe('audit-ai: Sync invoices');
  });

  it('leaves non-GitHub object titles unchanged', () => {
    expect(displayObjectTitle({ canonicalName: 'Send proposal', metadata: {} })).toBe(
      'Send proposal',
    );
  });
});
