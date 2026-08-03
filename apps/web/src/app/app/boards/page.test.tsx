import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveActiveTeam: vi.fn(),
  listBoards: vi.fn(),
  getCalendarSettings: vi.fn(),
}));

vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({
    boards: { listBoards: fakes.listBoards },
    calendar: { getCalendarSettings: fakes.getCalendarSettings },
  }),
}));
vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.resolveActiveTeam }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/components/boards/board-create-form', () => ({
  BoardCreateDialog: () => createElement('button', { type: 'button' }, 'Create board'),
}));
vi.mock('@/components/pins/pin-overflow-menu', () => ({
  PinOverflowMenu: ({ title }: { title: string }) =>
    createElement('button', { type: 'button', 'aria-label': `Actions for ${title}` }, 'Actions'),
}));
vi.mock('@/components/work-subnav', () => ({
  WorkSubnav: () => createElement('nav', { 'aria-label': 'Work' }),
}));

const { default: BoardsIndexPage } = await import('./page.js');

beforeEach(() => {
  vi.clearAllMocks();
  fakes.auth.mockResolvedValue({ user: { id: 'user-1' } });
  fakes.resolveActiveTeam.mockResolvedValue({ active: { teamId: 'team-1' } });
  fakes.getCalendarSettings.mockResolvedValue({ defaultTimezone: 'UTC' });
  fakes.listBoards.mockResolvedValue([]);
});

describe('BoardsIndexPage', () => {
  it('gives an empty boards index one direct route into board creation', async () => {
    const html = renderToStaticMarkup(await BoardsIndexPage());

    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('No boards yet');
    expect(html.match(/>Create board</g)).toHaveLength(1);
    expect(html).not.toContain('Capture source material');
  });

  it('keeps populated boards in one rounded list with keyboard-visible board links', async () => {
    fakes.listBoards.mockResolvedValue([
      {
        id: 'board-1',
        name: 'Launch plan',
        purpose: 'Coordinate the launch across the team.',
        templateKind: 'task_board',
        itemCount: 3,
        pinned: false,
        updatedAt: new Date('2026-08-03T12:00:00.000Z'),
      },
    ]);

    const html = renderToStaticMarkup(await BoardsIndexPage());

    expect(html).toContain('aria-label="Boards"');
    expect(html).toContain('overflow-hidden rounded-lg border border-border');
    expect(html).toContain('focus-visible:ring-2 focus-visible:ring-ring');
    expect(html).toContain('Launch plan');
    expect(html).toContain('3 items');
    expect(html.match(/>Create board</g)).toHaveLength(1);
  });
});
