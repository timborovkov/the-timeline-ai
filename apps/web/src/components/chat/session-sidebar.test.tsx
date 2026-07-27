// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  archive: vi.fn(),
  confirm: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('@/app/actions/chat', () => ({ archiveChatSessionAction: fakes.archive }));
vi.mock('@/components/ui/app-dialog', () => ({
  useAppDialog: () => ({ confirm: fakes.confirm, node: null }),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/app/chat',
  useRouter: () => ({ push: fakes.push, refresh: fakes.refresh }),
  useSearchParams: () => new URLSearchParams('session=session-1'),
}));

const { MobileSessionNav, SessionSidebar } = await import('./session-sidebar.js');

beforeEach(() => {
  vi.clearAllMocks();
  fakes.confirm.mockResolvedValue(true);
  fakes.archive.mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
});

describe('MobileSessionNav', () => {
  it('archives the active chat and returns to a fresh session', async () => {
    const user = userEvent.setup();
    render(
      <MobileSessionNav
        activeSessionId="session-1"
        sessions={[
          {
            id: 'session-1',
            surface: 'web',
            title: 'Launch review',
            pinnedEntityId: null,
            pinnedEntityName: null,
          },
        ]}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Archive chat' }));

    await waitFor(() => {
      expect(fakes.archive).toHaveBeenCalledWith({ sessionId: 'session-1' });
      expect(fakes.push).toHaveBeenCalledWith('/app/chat');
      expect(fakes.refresh).toHaveBeenCalled();
    });
  });

  it('labels Telegram, Slack, and future-provider sessions on mobile and desktop', () => {
    const sessions = [
      {
        id: 'telegram-session',
        surface: 'telegram',
        title: 'Telegram answer',
        pinnedEntityId: null,
        pinnedEntityName: null,
      },
      {
        id: 'slack-session',
        surface: 'slack',
        title: 'Slack answer',
        pinnedEntityId: null,
        pinnedEntityName: null,
      },
      {
        id: 'future-session',
        surface: 'discord',
        title: 'Future answer',
        pinnedEntityId: null,
        pinnedEntityName: null,
      },
    ];
    render(
      <>
        <SessionSidebar activeSessionId={null} sessions={sessions} />
        <MobileSessionNav activeSessionId={null} sessions={sessions} />
      </>,
    );

    expect(screen.getAllByLabelText('Telegram conversation')).toHaveLength(2);
    expect(screen.getAllByLabelText('Slack conversation')).toHaveLength(2);
    expect(screen.getAllByLabelText('External conversation')).toHaveLength(2);
  });
});
