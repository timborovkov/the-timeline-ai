import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({ auth: vi.fn() }));

vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));
vi.mock('@/components/help/support-form', () => ({
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
}));

const { default: SupportPage } = await import('./page.js');

beforeEach(() => {
  fakes.auth.mockReset();
  fakes.auth.mockResolvedValue({
    user: { name: 'Ada Lovelace', email: 'ada@example.test' },
  });
});

describe('support page', () => {
  it('routes private support, public bugs, security reports, and contributions', async () => {
    const html = renderToStaticMarkup(await SupportPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain('mailto:contact@thetimeline.cc');
    expect(html).toContain('issues/new?template=bug_report.yml');
    expect(html).toContain('/security/policy');
    expect(html).toContain('/blob/main/CONTRIBUTING.md');
    expect(html).toContain('Never disclose an unpatched vulnerability in a public issue.');
    expect(html).toContain('without customer data, personal data, or secrets');
  });

  it('passes only allowlisted app context and signed-in defaults to the private form', async () => {
    const html = renderToStaticMarkup(
      await SupportPage({
        searchParams: Promise.resolve({
          surface: 'board_detail',
          error: 'sentry-reference',
          token: 'must-not-appear',
        }),
      }),
    );

    expect(html).toContain('data-surface="board_detail"');
    expect(html).toContain('data-error-reference="sentry-reference"');
    expect(html).toContain('data-name="Ada Lovelace"');
    expect(html).not.toContain('must-not-appear');

    const rejected = renderToStaticMarkup(
      await SupportPage({
        searchParams: Promise.resolve({
          surface: 'https://timeline.test/app/boards/secret-id',
          error: 'reference?token=secret',
        }),
      }),
    );
    expect(rejected).toContain('data-surface=""');
    expect(rejected).toContain('data-error-reference=""');
    expect(rejected).not.toContain('secret-id');
  });
});
