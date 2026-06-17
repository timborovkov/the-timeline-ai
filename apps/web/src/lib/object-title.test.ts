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
          display_title_canonical_name: 'timborovkov/the-timeline-ai#202: Add cursor pagination',
        },
      }),
    ).toBe('the-timeline-ai: Add cursor pagination');
  });

  it('uses display titles for non-GitHub provider-managed names', () => {
    expect(
      displayObjectTitle({
        canonicalName: 'ENG-42: Wire Phase 11',
        metadata: {
          integration_provider: 'linear',
          integration_external_id: 'LIN-1',
          display_title: 'Wire Phase 11',
          display_title_canonical_name: 'ENG-42: Wire Phase 11',
        },
      }),
    ).toBe('Wire Phase 11');
  });

  it('uses the stored canonical name after an integration task is renamed by a user', () => {
    expect(
      displayObjectTitle({
        canonicalName: 'Use cursor pagination in the task board',
        metadata: {
          integration_provider: 'github',
          integration_external_id: 'timborovkov/the-timeline-ai#202',
          display_title: 'the-timeline-ai: Add cursor pagination',
          display_title_canonical_name: 'timborovkov/the-timeline-ai#202: Add cursor pagination',
        },
      }),
    ).toBe('Use cursor pagination in the task board');
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
