import { expect, vi } from '@timeline/test-support';
import { afterEach, it } from 'bun:test';
const toast = vi.hoisted(() => ({ loading: vi.fn(), success: vi.fn(), error: vi.fn() }));
await vi.mock(
  import.meta.resolve('sonner'),
  () => ({ toast }),
  () => import('sonner'),
);
const configure = vi.fn(
  (_previous: unknown, _data: FormData): Promise<{ saved?: boolean; error?: string }> =>
    Promise.resolve({ saved: true }),
);
// Only selected, edited messages leave the browser. Failures retain drafts and every edit renews consent.
const submit = vi.fn(
  (_previous: unknown, _data: FormData): Promise<{ error?: string; saved?: boolean }> =>
    Promise.resolve({ error: 'Could not send' }),
);
await vi.mock(
  import.meta.resolve('@/app/actions/diagnostics'),
  () => ({
    submitDiagnosticAction: submit,
    configureDiagnosticAction: configure,
    deleteDiagnosticAction: vi.fn(),
  }),
  () => import('@/app/actions/diagnostics'),
);
const { cleanup, fireEvent, render, screen, waitFor } = await import('@testing-library/react');
const { DiagnosticReportForm, DiagnosticSharingSettings } =
  await import('./diagnostic-report-form');
const messages = [
  { id: 'first', role: 'user' as const, text: 'Original sensitive message' },
  { id: 'second', role: 'assistant' as const, text: 'Private answer to exclude' },
];
const consentLabel = /I’ve reviewed the selected content/;
afterEach(() => {
  cleanup();
  submit.mockClear();
});
it('sends only edited selected text and preserves redactions when submission fails', async () => {
  render(<DiagnosticReportForm teamId="team" sessionId="session" initialMessages={messages} />);
  expect(submit).not.toHaveBeenCalled();
  const consent = screen.getByRole<HTMLInputElement>('checkbox', { name: consentLabel });
  const button = screen.getByRole<HTMLButtonElement>('button', {
    name: 'Share report',
  });
  expect(consent.checked).toBe(false);
  expect(button.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('What went wrong?'), {
    target: { value: 'Synthetic incorrect answer' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Edit message 1' }));
  fireEvent.change(screen.getByLabelText('Message 1 text'), {
    target: { value: 'Redacted message' },
  });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Include message 2 from Assistant' }));
  expect(screen.queryByText('Private answer to exclude')).toBeNull();
  fireEvent.click(consent);
  fireEvent.click(button);
  await waitFor(() => {
    expect(submit).toHaveBeenCalledTimes(1);
  });
  const submitted = submit.mock.calls[0]?.[1];
  expect(submitted?.get('conversation')).toBe('You:\nRedacted message');
  expect(JSON.stringify(submitted ? [...submitted.entries()] : [])).not.toContain('Private answer');
  expect(submitted?.get('consent')).toBe('on');
  await waitFor(() => {
    expect(screen.getByRole('alert').textContent).toBe('Could not send');
  });
  expect(screen.getByLabelText<HTMLTextAreaElement>('Message 1 text').value).toBe(
    'Redacted message',
  );
  fireEvent.change(screen.getByLabelText('Message 1 text'), { target: { value: 'Another edit' } });
  expect(consent.checked).toBe(false);
  fireEvent.click(consent);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Include message 2 from Assistant' }));
  expect(consent.checked).toBe(false);
});
it('prevents empty submissions and keeps edited text when toggling a message', () => {
  render(
    <DiagnosticReportForm
      teamId="team"
      sessionId="session"
      initialMessages={messages.slice(0, 1)}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Edit message 1' }));
  fireEvent.change(screen.getByLabelText('Message 1 text'), {
    target: { value: 'Safe edited text' },
  });
  const include = screen.getByRole('checkbox', { name: 'Include message 1 from You' });
  fireEvent.click(include);
  fireEvent.click(screen.getByRole('checkbox', { name: consentLabel }));
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Share report' }).disabled).toBe(
    true,
  );
  expect(screen.getByRole('status').textContent).toBe('0 of 1 messages selected');
  fireEvent.click(include);
  expect(screen.getByLabelText<HTMLTextAreaElement>('Message 1 text').value).toBe(
    'Safe edited text',
  );
  fireEvent.change(screen.getByLabelText('Message 1 text'), { target: { value: '   ' } });
  fireEvent.click(screen.getByRole('checkbox', { name: consentLabel }));
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Share report' }).disabled).toBe(
    true,
  );
});
it('keeps long messages intact and lets the sender exclude them to meet the limit', () => {
  const text = 'x'.repeat(60001);
  render(
    <DiagnosticReportForm
      teamId="team"
      sessionId="session"
      initialMessages={[{ id: 'long', role: 'user', text }, ...messages.slice(1)]}
    />,
  );
  expect(screen.getByText(text).textContent).toBe(text);
  expect(screen.getByRole('alert').textContent).toContain('too long');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Include message 1 from You' }));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('status').textContent).toBe('1 of 2 messages selected');
});

it('announces sharing preference saves and errors with toasts', async () => {
  render(<DiagnosticSharingSettings teamId="synthetic" enabled={false} />);
  fireEvent.click(screen.getByRole('button', { name: 'Save sharing preference' }));
  await waitFor(() => {
    expect(toast.success).toHaveBeenCalledWith('Sharing preference saved', expect.anything());
  });
  configure.mockResolvedValueOnce({ error: 'Only current admins can change sharing' });
  fireEvent.click(screen.getByRole('button', { name: 'Save sharing preference' }));
  await waitFor(() => {
    expect(toast.error).toHaveBeenCalledWith(
      'Only current admins can change sharing',
      expect.anything(),
    );
  });
});
