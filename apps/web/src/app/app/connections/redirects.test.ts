import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { describe, it } from 'bun:test';

await vi.mock(
  import.meta.resolve('next/navigation'),
  async () => ({
    ...(await import('next/navigation')),
    redirect: vi.fn(),
  }),
  () => import('next/navigation'),
);

const { redirect } = await import('next/navigation');
const { default: ConnectionsIndexPage } = await import('@/app/app/connections/page');
const { default: LegacySourcesRedirect } = await import('@/app/app/sources/page');
const { default: TelegramSettingsPage } = await import('@/app/app/team/telegram/page');

describe('Connections route redirects', () => {
  it('sends /app/connections to Sources while preserving query parameters', async () => {
    await ConnectionsIndexPage({
      searchParams: Promise.resolve({ error: 'oauth_denied' }),
    });
    expect(redirect).toHaveBeenCalledWith('/app/connections/sources?error=oauth_denied');
  });

  it('maps legacy /app/sources tab query parameters onto the matching tab route', async () => {
    await LegacySourcesRedirect({
      searchParams: Promise.resolve({ tab: 'developer', connected: 'hook-1' }),
    });
    expect(redirect).toHaveBeenCalledWith('/app/connections/developer?connected=hook-1');
  });

  it('opens the Telegram sheet from the legacy Telegram settings route', () => {
    TelegramSettingsPage();
    expect(redirect).toHaveBeenCalledWith('/app/connections/sources#telegram');
  });
});
