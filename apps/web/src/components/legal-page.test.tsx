import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { beforeEach, describe, it } from 'bun:test';
const fakes = vi.hoisted(() => ({ auth: vi.fn() }));

await vi.mock(
  import.meta.resolve('@/lib/auth'),
  () => ({ auth: fakes.auth }),
  () => import('@/lib/auth'),
);

const { renderToStaticMarkup } = await import('react-dom/server');

const { LegalPage } = await import('@/components/legal-page');

describe('LegalPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('offers signed-in visitors a route back to the app', async () => {
    fakes.auth.mockResolvedValue({ user: { id: 'user-1' } });

    const html = renderToStaticMarkup(
      await LegalPage({
        eyebrow: 'Version 1',
        title: 'Terms',
        description: 'Terms description',
        children: <p>Legal copy</p>,
      }),
    );

    expect(html).toContain('Dashboard');
    expect(html).not.toContain('>Sign in<');
  });
});
