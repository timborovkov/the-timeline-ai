import { describe, expect, it } from 'vitest';

import { displayObjectTitle } from '@/lib/object-title';

describe('displayObjectTitle', () => {
  it('prefers explicit display titles when they match the current canonical name', () => {
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

  it('normalizes whitespace in explicit display title metadata', () => {
    expect(
      displayObjectTitle({
        canonicalName: 'ENG-42: Wire Phase 11',
        metadata: {
          integration_provider: 'linear',
          display_title: '  Wire   Phase 11  ',
          display_title_canonical_name: 'ENG-42: Wire Phase 11',
        },
      }),
    ).toBe('Wire Phase 11');
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

  it('uses display titles for numeric metadata values when the source matches', () => {
    expect(
      displayObjectTitle({
        canonicalName: '42',
        metadata: {
          display_title: 42,
          display_title_canonical_name: 42,
        },
      }),
    ).toBe('42');
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

  it('uses the stored canonical name when display title metadata has no source marker', () => {
    expect(
      displayObjectTitle({
        canonicalName: 'timborovkov/the-timeline-ai#202: Add cursor pagination',
        metadata: {
          integration_provider: 'github',
          display_title: 'the-timeline-ai: Add cursor pagination',
        },
      }),
    ).toBe('timborovkov/the-timeline-ai#202: Add cursor pagination');
  });

  it('uses the stored canonical name when display title metadata is stale', () => {
    expect(
      displayObjectTitle({
        canonicalName: 'ENG-43: Ship new board',
        metadata: {
          integration_provider: 'linear',
          integration_external_id: 'LIN-1',
          display_title: 'Wire Phase 11',
          display_title_canonical_name: 'ENG-42: Wire Phase 11',
        },
      }),
    ).toBe('ENG-43: Ship new board');
  });

  it('does not rewrite legacy GitHub-shaped canonical names without source-tracked display titles', () => {
    expect(
      displayObjectTitle({
        canonicalName: 'timborovkov/the-timeline-ai#202: Add cursor pagination',
        metadata: {
          integration_provider: 'github',
          integration_external_id: 'timborovkov/the-timeline-ai#202',
        },
      }),
    ).toBe('timborovkov/the-timeline-ai#202: Add cursor pagination');

    expect(
      displayObjectTitle({
        canonicalName: 'timborovkov/audit-ai#19: Sync invoices',
        metadata: {
          integration_provider: 'github',
          integration_external_id: 'timborovkov/audit-ai#issue:19',
        },
      }),
    ).toBe('timborovkov/audit-ai#19: Sync invoices');
  });

  it('leaves non-GitHub object titles unchanged', () => {
    expect(displayObjectTitle({ canonicalName: 'Send proposal', metadata: {} })).toBe(
      'Send proposal',
    );
  });
});
