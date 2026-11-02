import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';
// Test environment: happy-dom

const fakes = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
}));

await vi.mock(
  import.meta.resolve('next/navigation'),
  async () => ({
    ...(await import('next/navigation')),
    useSearchParams: () => fakes.searchParams,
  }),
  () => import('next/navigation'),
);
await vi.mock(
  import.meta.resolve('@/components/help/support-form'),
  async () => {
    const { useState } = await import('react');
    return {
      SupportForm: (props: {
        defaultSurface?: string;
        defaultErrorReference?: string;
        defaultName?: string;
        defaultEmail?: string;
      }) => {
        const [message, setMessage] = useState('');
        return (
          <div
            data-testid="support-form"
            data-surface={props.defaultSurface ?? ''}
            data-error-reference={props.defaultErrorReference ?? ''}
            data-name={props.defaultName ?? ''}
            data-email={props.defaultEmail ?? ''}
          >
            <textarea
              aria-label="Message"
              value={message}
              onChange={(event) => {
                setMessage(event.target.value);
              }}
            />
          </div>
        );
      },
    };
  },
  () => import('@/components/help/support-form'),
);

const { act, cleanup, render, screen } = await import('@testing-library/react');
const { default: userEvent } = await import('@testing-library/user-event');
const { SupportRequestForm } = await import('@/components/help/support-request-form');
const { resetPublicSessionCache, setPublicSessionCache } = await import('@/lib/public-session');

afterEach(() => {
  cleanup();
  resetPublicSessionCache();
  fakes.searchParams = new URLSearchParams();
});

describe('support request form', () => {
  it('passes only allowlisted app context and signed-in defaults to the private form', () => {
    fakes.searchParams = new URLSearchParams({
      surface: 'board_detail',
      error: 'sentry-reference',
      token: 'must-not-appear',
    });
    setPublicSessionCache({
      status: 'signed-in',
      name: 'Ada Lovelace',
      email: 'ada@example.test',
    });

    render(<SupportRequestForm requiresTurnstile={false} />);

    const form = screen.getByTestId('support-form');
    expect(form.getAttribute('data-surface')).toBe('board_detail');
    expect(form.getAttribute('data-error-reference')).toBe('sentry-reference');
    expect(form.getAttribute('data-name')).toBe('Ada Lovelace');
    expect(form.getAttribute('data-email')).toBe('ada@example.test');
    expect(form.outerHTML).not.toContain('must-not-appear');
  });

  it('rejects non-allowlisted surface and error query values', () => {
    fakes.searchParams = new URLSearchParams({
      surface: 'https://timeline.test/app/boards/secret-id',
      error: 'reference?token=secret',
    });
    setPublicSessionCache({ status: 'signed-out' });

    render(<SupportRequestForm requiresTurnstile={false} />);

    const form = screen.getByTestId('support-form');
    expect(form.getAttribute('data-surface')).toBe('');
    expect(form.getAttribute('data-error-reference')).toBe('');
    expect(form.outerHTML).not.toContain('secret-id');
  });

  it('keeps typed values after the public session resolves', async () => {
    const user = userEvent.setup();
    render(<SupportRequestForm requiresTurnstile={false} />);

    await user.type(screen.getByLabelText('Message'), 'I already started this request.');
    act(() => {
      setPublicSessionCache({
        status: 'signed-in',
        name: 'Ada Lovelace',
        email: 'ada@example.test',
      });
    });

    expect(screen.getByLabelText<HTMLTextAreaElement>('Message').value).toBe(
      'I already started this request.',
    );
    expect(screen.getByTestId('support-form').getAttribute('data-name')).toBe('Ada Lovelace');
    expect(screen.getByTestId('support-form').getAttribute('data-email')).toBe('ada@example.test');
  });
});
