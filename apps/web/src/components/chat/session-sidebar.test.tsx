// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { formatDisplayDateTime } from '@/lib/display-dates';
import { DEFAULT_TIMEZONE } from '@/lib/timezones';

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

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function sessionFixture(
  overrides: Partial<{
    id: string;
    surface: string;
    title: string | null;
    pinnedEntityId: string | null;
    pinnedEntityName: string | null;
    updatedAt: string;
  }> = {},
) {
  return {
    id: 'session-1',
    surface: 'web',
    title: 'Launch review',
    pinnedEntityId: null,
    pinnedEntityName: null,
    updatedAt: new Date(Date.now() - WEEK_MS).toISOString(),
    ...overrides,
  };
}

function renderMobileNav({
  sessions,
  activeSessionId,
  activeTitle,
}: {
  sessions: ReturnType<typeof sessionFixture>[];
  activeSessionId: string | null;
  activeTitle?: string | null;
}) {
  const resolvedTitle =
    activeTitle !== undefined
      ? activeTitle
      : (sessions.find((session) => session.id === activeSessionId)?.title ?? null);
  return render(
    <MobileSessionNav
      activeSessionId={activeSessionId}
      activeTitle={resolvedTitle}
      sessions={sessions}
    />,
  );
}

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
    renderMobileNav({ activeSessionId: 'session-1', sessions: [sessionFixture()] });

    await user.click(screen.getByRole('button', { name: 'Archive chat: Launch review' }));

    await waitFor(() => {
      expect(fakes.archive).toHaveBeenCalledWith({ sessionId: 'session-1' });
      expect(fakes.push).toHaveBeenCalledWith('/app/chat');
      expect(fakes.refresh).toHaveBeenCalled();
    });
  });

  it('labels Telegram, Slack, and future-provider sessions on mobile and desktop', () => {
    const sessions = [
      sessionFixture({
        id: 'telegram-session',
        surface: 'telegram',
        title: 'Telegram answer',
      }),
      sessionFixture({
        id: 'slack-session',
        surface: 'slack',
        title: 'Slack answer',
      }),
      sessionFixture({
        id: 'future-session',
        surface: 'discord',
        title: 'Future answer',
      }),
    ];
    render(
      <>
        <SessionSidebar activeSessionId={null} sessions={sessions} />
        <MobileSessionNav activeSessionId={null} activeTitle={null} sessions={sessions} />
      </>,
    );

    expect(screen.getAllByLabelText('Telegram conversation')).toHaveLength(2);
    expect(screen.getAllByLabelText('Slack conversation')).toHaveLength(2);
    expect(screen.getAllByLabelText('External conversation')).toHaveLength(2);
  });

  it('marks the active desktop session and keeps its archive action keyboard reachable', () => {
    render(<SessionSidebar activeSessionId="session-1" sessions={[sessionFixture()]} />);

    expect(screen.getByRole('link', { name: /Launch review/ }).getAttribute('aria-current')).toBe(
      'page',
    );
    const archive = screen.getByRole('button', { name: 'Archive chat: Launch review' });
    expect(archive).toBeTruthy();
    expect(archive.closest('fieldset')?.className).toContain('opacity-0');
    expect(archive.closest('fieldset')?.className).toContain('group-hover:opacity-100');
    expect(archive.closest('fieldset')?.className).toContain('focus-within:opacity-100');
  });

  it('uses the shared ghost button for new chats', () => {
    render(<SessionSidebar activeSessionId={null} sessions={[sessionFixture()]} />);

    const newChat = screen.getByRole('button', { name: 'New chat' });
    expect(newChat.className).toContain('hover:bg-accent');
    expect(newChat.className).not.toContain('bg-primary');
    expect(newChat.className).not.toContain('border-input');
  });

  it('filters desktop and mobile session lists from the search field', async () => {
    const user = userEvent.setup();
    const sessions = [
      sessionFixture(),
      sessionFixture({
        id: 'session-2',
        title: 'Website requirements',
        updatedAt: new Date(Date.now() - 2 * WEEK_MS).toISOString(),
      }),
    ];
    render(
      <>
        <SessionSidebar activeSessionId={null} sessions={sessions} />
        <MobileSessionNav activeSessionId={null} activeTitle={null} sessions={sessions} />
      </>,
    );

    const searchFields = screen.getAllByRole('searchbox', { name: 'Search chats' });
    expect(searchFields).toHaveLength(2);
    for (const field of searchFields) {
      await user.type(field, 'website');
    }

    expect(screen.getAllByRole('link', { name: /Website requirements/ })).toHaveLength(2);
    expect(screen.queryByRole('link', { name: /Launch review/ })).toBeNull();
  });

  it('shows last-activity age, a timestamp title, and short hairlines between rows', () => {
    const older = sessionFixture();
    const newer = sessionFixture({
      id: 'session-2',
      title: 'Website requirements',
      updatedAt: new Date(Date.now() - 2 * WEEK_MS).toISOString(),
    });
    const { container } = render(
      <>
        <SessionSidebar activeSessionId={null} sessions={[older, newer]} />
        <MobileSessionNav activeSessionId={null} activeTitle={null} sessions={[older, newer]} />
      </>,
    );

    expect(screen.getAllByText('7 days ago')).toHaveLength(2);
    expect(screen.getAllByText('14 days ago')).toHaveLength(2);
    const age = screen.getAllByText('7 days ago')[0];
    expect(age?.getAttribute('datetime')).toBe(older.updatedAt);
    expect(age?.getAttribute('title')).toBe(
      formatDisplayDateTime(older.updatedAt, { timezone: DEFAULT_TIMEZONE }),
    );
    expect(container.querySelectorAll('[data-session-rule="true"]')).toHaveLength(2);
    expect(container.querySelector('[data-session-rule="true"]')?.className).toContain('w-[60%]');
  });

  it('uses the resolved title when the active session is outside the listed window', () => {
    renderMobileNav({
      sessions: [sessionFixture()],
      activeSessionId: 'session-deep',
      activeTitle: 'Deep linked recap',
    });

    expect(screen.getByText('Deep linked recap')).toBeTruthy();
    expect(screen.queryByText('Current chat')).toBeNull();
  });

  it('omits clock-relative age during SSR', () => {
    const session = sessionFixture();
    const html = renderToStaticMarkup(
      <SessionSidebar activeSessionId={null} sessions={[session]} />,
    );

    expect(html).not.toContain('days ago');
    expect(html).toContain(`dateTime="${session.updatedAt}"`);
    expect(html).not.toContain('title=');
  });
});
