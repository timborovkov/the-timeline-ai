import { expect, vi } from '@timeline/test-support';
import { afterEach, it } from 'bun:test';

// Sharing starts unchecked. Withdrawal must remain possible without consenting again.
const configure = vi.fn((_previous: unknown, _data: FormData): Promise<{ saved?: boolean }> =>
  Promise.resolve({ saved: true }),
);
await vi.mock(
  import.meta.resolve('@/app/actions/evaluation-tracing'),
  () => ({ configureEvaluationTracingAction: configure }),
  () => import('@/app/actions/evaluation-tracing'),
);
const { cleanup, fireEvent, render, screen, waitFor } = await import('@testing-library/react');
const { EvaluationTracingSettings } = await import('./evaluation-tracing-settings');
afterEach(() => {
  cleanup();
  configure.mockClear();
});
it('starts off with no sources or acknowledgment selected', () => {
  render(<EvaluationTracingSettings teamId="synthetic" enabled={false} sources={[]} />);
  for (const checkbox of screen.getAllByRole<HTMLInputElement>('checkbox'))
    expect(checkbox.checked).toBe(false);
  expect(configure).not.toHaveBeenCalled();
});
it('allows withdrawal without checking the acknowledgment', async () => {
  render(<EvaluationTracingSettings teamId="synthetic" enabled sources={['telegram']} />);
  fireEvent.click(screen.getByRole('checkbox', { name: /Share selected source processing/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Save evaluation preference' }));
  await waitFor(() => {
    expect(configure).toHaveBeenCalledTimes(1);
  });
  const data = configure.mock.calls[0]?.[1];
  expect(data?.get('enabled')).toBeNull();
  expect(data?.get('consent')).toBeNull();
  expect(data?.getAll('sources')).toEqual(['telegram']);
});
