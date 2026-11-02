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
  () => ({
    SupportForm: (props: {
      defaultSurface?: string;
      defaultErrorReference?: string;
      defaultName?: string;
      defaultEmail?: string;
    }) => (
      <div
        data-testid="support-form"
        data-surface={props.defaultSurface ?? ''}
        data-error-reference={props.defaultErrorReference ?? ''}
        data-name={props.defaultName ?? ''}
        data-email={props.defaultEmail ?? ''}
      />
    ),
  }),
  () => import('@/components/help/support-form'),
);

const { cleanup, render, screen } = await import('@testing-library/react');
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
});
