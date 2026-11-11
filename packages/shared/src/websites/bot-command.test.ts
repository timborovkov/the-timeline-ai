import { expect, vi } from '@timeline/test-support';
import { beforeEach, it } from 'bun:test';

import type { Db } from '@timeline/db';
const mocks = vi.hoisted(() => ({ start: vi.fn(), add: vi.fn(), list: vi.fn(), member: vi.fn() }));
await vi.mock(
  import.meta.resolve('#src/websites/runtime.js'),
  () => ({ startWebsiteScan: mocks.start }),
  () => import('#src/websites/runtime.js'),
);
await vi.mock(
  import.meta.resolve('#src/team-scope.js'),
  () => ({
    withTeam: (_db: unknown, teamId: string, userId: string) => ({
      teamId,
      userId,
      requireMembership: mocks.member,
      timeline: { team: () => Promise.resolve({ name: 'Bound team' }) },
      websites: { add: mocks.add, list: mocks.list },
    }),
  }),
  () => import('#src/team-scope.js'),
);
const { websiteBotCommand } = await import('#src/websites/bot-command.js');
const input = {
  db: {} as Db,
  teamId: 'bound-team',
  userId: 'member',
  command: '/crawl',
  requestId: 'telegram-request',
  delivery: {
    provider: 'telegram' as const,
    token: 'test-token',
    accountId: 'bot',
    method: 'send' as const,
    body: { chat_id: '123' },
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.member.mockResolvedValue('member');
  mocks.list.mockResolvedValue([{ id: 'source', url: 'https://example.com/' }]);
  mocks.start.mockResolvedValue({ id: 'run', status: 'queued' });
});
it('shows team, price and permission before creating or enqueueing anything', async () => {
  const result = await websiteBotCommand({ ...input, arg: 'https://example.com' });
  expect(result).toContain('Bound team');
  expect(result).toContain('20 per page');
  expect(result).toContain('permission');
  expect(mocks.add).not.toHaveBeenCalled();
  expect(mocks.start).not.toHaveBeenCalled();
});
it('preserves bound team, member and delivery identity after explicit confirmation', async () => {
  await websiteBotCommand({ ...input, arg: 'https://example.com confirm' });
  expect(mocks.start).toHaveBeenCalledWith(
    expect.objectContaining({ teamId: 'bound-team', userId: 'member' }),
    expect.objectContaining({
      websiteId: 'source',
      idempotencyKey: 'telegram-request',
      permissionConfirmed: true,
      notification: expect.objectContaining({ provider: 'telegram' }) as unknown,
    }),
  );
});
