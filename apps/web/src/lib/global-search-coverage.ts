import type { GlobalSearchCoverage, GlobalSearchKind } from '@timeline/shared/search';

const labels: Record<GlobalSearchKind, string> = {
  quick_link: 'Pages',
  external_link: 'Pages',
  object: 'Objects',
  task: 'Tasks',
  board: 'Boards',
  calendar_event: 'Calendar',
  timeline_event: 'Timeline',
  document_chunk: 'Documents',
};

export function globalSearchCoverageText(coverage: GlobalSearchCoverage): string {
  const labelsFor = (status: GlobalSearchCoverage[GlobalSearchKind]) =>
    [
      ...new Set(
        (Object.keys(labels) as GlobalSearchKind[])
          .filter((kind) => coverage[kind] === status)
          .map((kind) => labels[kind]),
      ),
    ].join(', ');
  const searched = labelsFor('searched');
  const keyword = labelsFor('keyword');
  const partial = labelsFor('partial');
  const unavailable = labelsFor('unavailable');
  return [
    searched && 'Searched ' + searched + '.',
    keyword && 'Keyword matches only in ' + keyword + '.',
    partial && 'Limited coverage in ' + partial + '.',
    unavailable && 'Search unavailable for ' + unavailable + '.',
  ]
    .filter(Boolean)
    .join(' ');
}
