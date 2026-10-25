import { PGlite } from '@electric-sql/pglite';
import { rawEvents, teamMembers, teams, users } from '@timeline/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const log = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('#src/logger.js', () => ({
  childLogger: () => log,
  logger: log,
}));

import type { PostmarkInbound } from '#src/email/postmark-schema.js';

import { handleInbound, inboundRecipientLogHints } from '#src/email/dispatcher.js';
import { applyDbMigrations } from '#src/test/pglite.js';
import { textQueueDeps } from '#src/test/queue-deps.js';

const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function inboundPayload(messageId: string): PostmarkInbound {
  return {
    MessageID: `postmark-${messageId}`,
    Date: '2026-05-27T09:00:00Z',
    Subject: 'Vendor note',
    From: 'vendor@example.net',
    FromName: 'Vendor',
    FromFull: { Email: 'vendor@example.net', Name: 'Vendor', MailboxHash: '' },
    To: 'team-a@inbound.test',
    ToFull: [{ Email: 'team-a@inbound.test', Name: 'Team A', MailboxHash: '' }],
    Cc: '',
    CcFull: [],
    Bcc: '',
    BccFull: [],
    OriginalRecipient: '',
    ReplyTo: '',
    MailboxHash: 'team-a',
    TextBody: 'Please review this.',
    HtmlBody: '',
    StrippedTextReply: '',
    Tag: '',
    Headers: [{ Name: 'Message-ID', Value: `<${messageId}@example.net>` }],
    Attachments: [],
  };
}

describe('inbound email drop logging', () => {
  let pg: PGlite;

  beforeEach(async () => {
    log.debug.mockReset();
    log.info.mockReset();
    log.warn.mockReset();
    log.error.mockReset();
    pg = new PGlite();
    await applyDbMigrations(pg);
  });

  afterEach(async () => {
    await pg.close();
  });

  it('summarizes recipient domain and slug without full addresses', () => {
    expect(
      inboundRecipientLogHints(
        ['lost-team@inbound.test', 'ada@gmail.com'],
        'lost-team',
        'inbound.test',
      ),
    ).toEqual({
      domains: ['inbound.test', 'gmail.com'],
      slugs: ['lost-team'],
    });
  });

  it('logs no_recipients without message content', async () => {
    const db = drizzle(pg);
    await handleInbound(
      { db: db as never, inboundDomain: 'inbound.test' },
      {
        ...inboundPayload('empty-recipients'),
        MailboxHash: '',
        To: '',
        ToFull: [],
        OriginalRecipient: '',
        TextBody: 'secret body that must not be logged',
      },
    );

    expect(log.info).toHaveBeenCalledWith('inbound email dropped: no_recipients');
    expect(JSON.stringify(log.info.mock.calls)).not.toContain('secret body');
    expect(JSON.stringify(log.info.mock.calls)).not.toContain('vendor@example.net');
  });

  it('logs no_matching_team with domain and slug, not the full address', async () => {
    const db = drizzle(pg);
    await handleInbound(
      { db: db as never, inboundDomain: 'inbound.test' },
      {
        ...inboundPayload('missing-team'),
        MailboxHash: 'lost-team',
        To: 'lost-team@inbound.test',
        ToFull: [{ Email: 'lost-team@inbound.test', Name: 'Lost', MailboxHash: 'lost-team' }],
        TextBody: 'do not log this secret',
      },
    );

    const line = log.info.mock.calls.find((call) =>
      String(call[1] ?? call[0]).includes('no_matching_team'),
    );
    expect(line?.[1] ?? line?.[0]).toBe(
      'inbound email dropped: no_matching_team domain=inbound.test slug=lost-team',
    );
    expect(line?.[0]).toMatchObject({
      recipientDomains: ['inbound.test'],
      slugs: ['lost-team'],
    });
    expect(JSON.stringify(log.info.mock.calls)).not.toContain('lost-team@inbound.test');
    expect(JSON.stringify(log.info.mock.calls)).not.toContain('do not log this secret');
    expect(JSON.stringify(log.info.mock.calls)).not.toContain('vendor@example.net');
  });

  it('logs a debug dedup hit without the message body', async () => {
    const db = drizzle(pg);
    await db.insert(teams).values({
      id: TEAM_ID,
      slug: 'team-a',
      name: 'Team A',
      inboundEmail: 'team-a@inbound.test',
    });
    await db.insert(users).values({ id: USER_ID, email: 'member@example.com' });
    await db.insert(teamMembers).values({
      teamId: TEAM_ID,
      userId: USER_ID,
      role: 'owner',
    });

    const queues = textQueueDeps();
    const payload = inboundPayload('duplicate-note');
    payload.TextBody = 'secret retry body';
    await handleInbound({ db: db as never, inboundDomain: 'inbound.test', ...queues }, payload);
    await handleInbound({ db: db as never, inboundDomain: 'inbound.test', ...queues }, payload);

    expect(log.debug).toHaveBeenCalledWith({ teamId: TEAM_ID }, 'inbound email dropped: dedup hit');
    expect(JSON.stringify(log.debug.mock.calls)).not.toContain('secret retry body');
    const rows = await db.select().from(rawEvents).where(eq(rawEvents.source, 'email'));
    expect(rows).toHaveLength(1);
  });
});
