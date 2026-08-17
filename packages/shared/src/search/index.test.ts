import { describe, expect, it } from 'vitest';

import {
  finalizeGlobalSearchResult,
  rankGlobalSearchResults,
  scoreLexical,
  searchQuickLinks,
  type GlobalSearchResult,
} from '#src/search/index.js';

function result(input: {
  id: string;
  kind: GlobalSearchResult['kind'];
  title: string;
  semantic?: number;
  lexical?: number;
  titleScore?: number;
  navigation?: number;
}): GlobalSearchResult {
  const scoreParts: GlobalSearchResult['scoreParts'] = {};
  if (input.semantic !== undefined) scoreParts.semantic = input.semantic;
  if (input.lexical !== undefined) scoreParts.lexical = input.lexical;
  if (input.titleScore !== undefined) scoreParts.title = input.titleScore;
  if (input.navigation !== undefined) scoreParts.navigation = input.navigation;
  return finalizeGlobalSearchResult({
    id: input.id,
    kind: input.kind,
    title: input.title,
    snippet: input.title,
    href: `/app/${input.id}`,
    scoreParts,
  });
}

describe('global search ranking', () => {
  it('ranks GitHub integration above incidental timeline mentions', () => {
    const quick = searchQuickLinks({ query: 'github', includeAdmin: true });
    const timeline = result({
      id: 'event',
      kind: 'timeline_event',
      title: 'Someone mentioned GitHub in passing',
      semantic: 0.68,
    });

    const ranked = rankGlobalSearchResults([...quick, timeline]);

    expect(ranked[0]?.id).toBe('github-integration');
  });

  it('ranks invite team member first for invite intent', () => {
    const ranked = searchQuickLinks({ query: 'invite team member', includeAdmin: true });

    expect(ranked[0]?.id).toBe('invite-member');
  });

  it('lets exact object names outrank semantic chatter', () => {
    const objectParts = scoreLexical({
      query: 'Otto Silventola',
      title: 'Otto Silventola',
      fields: ['person'],
    });
    const object = finalizeGlobalSearchResult({
      id: 'object',
      kind: 'object',
      title: 'Otto Silventola',
      snippet: 'Person',
      href: '/app/objects/object',
      scoreParts: objectParts,
    });
    const timeline = result({
      id: 'timeline',
      kind: 'timeline_event',
      title: 'Discussed Otto',
      semantic: 0.78,
    });

    expect(rankGlobalSearchResults([timeline, object])[0]?.id).toBe('object');
  });

  it('keeps exact document navigation above document chunks for short docs queries', () => {
    const quick = searchQuickLinks({ query: 'documents', includeAdmin: true });
    const chunk = result({
      id: 'chunk',
      kind: 'document_chunk',
      title: 'Internal documentation snippet',
      semantic: 0.88,
    });

    expect(rankGlobalSearchResults([...quick, chunk])[0]?.id).toBe('documents');
  });

  it('routes Monday.com subitem and WorkDoc searches to the Monday integration', () => {
    expect(searchQuickLinks({ query: 'monday subitems', includeAdmin: true })[0]?.id).toBe(
      'monday-integration',
    );
    expect(searchQuickLinks({ query: 'workdocs monday', includeAdmin: true })[0]?.id).toBe(
      'monday-integration',
    );
  });

  it('routes digest history searches to Work → Digests', () => {
    expect(searchQuickLinks({ query: 'daily digest', includeAdmin: true })[0]?.id).toBe('digests');
  });

  it('routes failed-job searches to admin Job recovery', () => {
    expect(searchQuickLinks({ query: 'failed jobs', includeAdmin: true })[0]?.id).toBe(
      'job-recovery',
    );
    expect(searchQuickLinks({ query: 'failed jobs', includeAdmin: false })).toEqual([]);
  });
});
