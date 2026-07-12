// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({ searchObjectsAction: vi.fn() }));

vi.mock('@/app/actions/objects', () => ({ searchObjectsAction: fakes.searchObjectsAction }));

const { useProjectSearch } = await import('./use-project-search.js');

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function Harness() {
  const { query, setQuery, projects } = useProjectSearch();
  return (
    <>
      <input
        aria-label="Project query"
        value={query}
        onChange={(event) => {
          setQuery(event.currentTarget.value);
        }}
      />
      <output>{projects.map((project) => project.label).join(',')}</output>
    </>
  );
}

describe('useProjectSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fakes.searchObjectsAction.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('returns remote projects and ignores a stale request', async () => {
    const first = deferred<{ results: { id: string; type: string; canonicalName: string }[] }>();
    const second = deferred<{ results: { id: string; type: string; canonicalName: string }[] }>();
    fakes.searchObjectsAction
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    render(<Harness />);

    fireEvent.change(screen.getByLabelText('Project query'), { target: { value: 'Fa' } });
    await act(() => vi.advanceTimersByTimeAsync(250));
    fireEvent.change(screen.getByLabelText('Project query'), { target: { value: 'Faba' } });
    await act(() => vi.advanceTimersByTimeAsync(250));

    await act(async () => {
      second.resolve({
        results: [{ id: 'project-new', type: 'project', canonicalName: 'Faba redesign' }],
      });
      await second.promise;
    });
    expect(screen.getByText('Faba redesign')).toBeTruthy();

    await act(async () => {
      first.resolve({
        results: [{ id: 'project-old', type: 'project', canonicalName: 'Old result' }],
      });
      await first.promise;
    });
    expect(screen.queryByText('Old result')).toBeNull();
    expect(fakes.searchObjectsAction).toHaveBeenNthCalledWith(2, {
      query: 'Faba',
      type: 'project',
    });
  });
});
