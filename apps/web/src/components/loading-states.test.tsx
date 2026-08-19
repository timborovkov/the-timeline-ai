// @vitest-environment happy-dom

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  CollectionGroupSkeleton,
  CollectionTableSkeleton,
  CollectionToolbarSkeleton,
  CompactKanbanSkeleton,
  PageHeaderSkeleton,
} from '@/components/loading-states';

afterEach(cleanup);

describe('collection loading skeletons', () => {
  it('puts search, filters, view segments, and add on one toolbar row', () => {
    const { container } = render(<CollectionToolbarSkeleton viewSegments={3} action />);
    const toolbar = container.querySelector('[data-loading-toolbar="collection"]');
    expect(toolbar).toBeTruthy();
    const row = toolbar?.querySelector('.flex.min-h-11');
    expect(row).toBeTruthy();
    expect(row?.querySelectorAll('.animate-pulse').length).toBeGreaterThan(4);
    expect(toolbar?.querySelectorAll('a, button, input, select, textarea')).toHaveLength(0);
  });

  it('can omit search and inventory count for toolbar-only feeds', () => {
    const { container } = render(
      <CollectionToolbarSkeleton search={false} count={false} viewSegments={2} />,
    );
    const row = container.querySelector('[data-loading-toolbar="collection"] .flex.min-h-11');
    expect(row?.querySelectorAll('.animate-pulse').length).toBe(3);
  });

  it('renders compact kanban lanes and a full-bleed table', () => {
    const kanban = render(<CompactKanbanSkeleton />);
    expect(kanban.container.querySelectorAll('[class*="min(290px"]').length).toBe(3);
    kanban.unmount();

    const table = render(<CollectionTableSkeleton />);
    expect(table.container.querySelectorAll('.min-h-11').length).toBeGreaterThan(0);
    expect(table.container.querySelector('.overflow-auto')).toBeTruthy();
  });

  it('can omit header metadata and show a compact header action', () => {
    const quiet = render(<PageHeaderSkeleton showMetadata={false} />);
    expect(quiet.container.querySelectorAll('.animate-pulse').length).toBe(2);
    quiet.unmount();

    const withAction = render(<PageHeaderSkeleton action />);
    expect(withAction.container.querySelectorAll('.animate-pulse').length).toBe(5);
  });

  it('renders grouped collection rows', () => {
    const { container } = render(<CollectionGroupSkeleton groups={2} rows={3} subtitle />);
    expect(container.querySelectorAll('section')).toHaveLength(2);
    expect(container.querySelectorAll('.min-h-11').length).toBe(6);
    expect(container.innerHTML).not.toContain('last:border-b-0');
    expect(container.innerHTML).not.toContain('border-x');
  });
});
