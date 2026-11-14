import { expect, vi } from '@timeline/test-support';
import { afterEach, it } from 'bun:test';
// Users must deliberately consent and can edit content; a failed submission preserves their edits.
const submit = vi.fn(
  (_previous: unknown, _data: FormData): Promise<{ error?: string; saved?: boolean }> =>
    Promise.resolve({ error: 'Could not send' }),
);
await vi.mock(
  import.meta.resolve('@/app/actions/diagnostics'),
  () => ({
    submitDiagnosticAction: submit,
    configureDiagnosticAction: vi.fn(),
    deleteDiagnosticAction: vi.fn(),
  }),
  () => import('@/app/actions/diagnostics'),
);
const { cleanup, fireEvent, render, screen, waitFor } = await import('@testing-library/react');
const { DiagnosticReportForm } = await import('./diagnostic-report-form');
afterEach(() => {
  cleanup();
  submit.mockClear();
});
it('previews without submitting, requires consent, and sends only edited text', async () => {
  render(
    <DiagnosticReportForm
      teamId="team"
      sessionId="session"
      conversation="You: Original sensitive message"
    />,
  );
  expect(submit).not.toHaveBeenCalled();
  const consent = screen.getByRole<HTMLInputElement>('checkbox');
  const button = screen.getByRole<HTMLButtonElement>('button', { name: 'Share this report' });
  expect(consent.checked).toBe(false);
  expect(button.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('What went wrong?'), {
    target: { value: 'Synthetic incorrect answer' },
  });
  fireEvent.change(screen.getByLabelText('Conversation to share'), {
    target: { value: 'You: Redacted message' },
  });
  fireEvent.click(consent);
  fireEvent.click(button);
  await waitFor(() => {
    expect(submit).toHaveBeenCalledTimes(1);
  });
  expect(submit.mock.calls[0]?.[1].get('conversation')).toBe('You: Redacted message');
  expect(submit.mock.calls[0]?.[1].get('consent')).toBe('on');
  await waitFor(() => {
    expect(screen.getByRole('alert').textContent).toBe('Could not send');
  });
  expect(screen.getByLabelText<HTMLTextAreaElement>('Conversation to share').value).toBe(
    'You: Redacted message',
  );
  fireEvent.change(screen.getByLabelText('Conversation to share'), {
    target: { value: 'Another edit' },
  });
  expect(consent.checked).toBe(false);
});
it('keeps long previews intact and asks the sender to shorten them', () => {
  const text = 'x'.repeat(60001);
  render(<DiagnosticReportForm teamId="team" sessionId="session" conversation={text} />);
  expect(screen.getByLabelText<HTMLTextAreaElement>('Conversation to share').value).toBe(text);
  expect(screen.getByRole('status').textContent).toContain('too long');
  expect(
    screen.getByRole<HTMLButtonElement>('button', { name: 'Share this report' }).disabled,
  ).toBe(true);
});
