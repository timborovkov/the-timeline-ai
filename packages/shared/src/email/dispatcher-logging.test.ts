import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';

import type { InboundEmail } from '#src/email/inbound-schema.js';
import type { PGlite as PGliteType } from '@electric-sql/pglite';
type PGlite = PGliteType;

const log = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

await vi.mock(
  import.meta.resolve('#src/logger.js'),
  () => ({
    childLogger: () => log,
    logger: log,
  }),
  () => import('#src/logger.js'),
);

const { PGlite } = await import('@electric-sql/pglite');
const { rawEvents, teamMembers, teams, users } = await import('@timeline/db');
const { eq } = await import('drizzle-orm');
const { drizzle } = await import('drizzle-orm/pglite');
const { handleInbound, inboundRecipientLogHints } = await import('#src/email/dispatcher.js');
const { applyDbMigrations } = await import('#src/test/pglite.js');
const { textQueueDeps } = await import('#src/test/queue-deps.js');

const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function inboundPayload(messageId: string): InboundEmail {
  return {
    providerId: `resend-${messageId}`,
    sentAt: '2026-05-27T09:00:00Z',
    subject: 'Vendor note',
    from: 'vendor@example.net',
    fromName: 'Vendor',
    fromAddress: { email: 'vendor@example.net', name: 'Vendor' },

    toAddresses: [{ email: 'team-a@inbound.test', name: 'Team A' }],

    ccAddresses: [],

    bccAddresses: [],

    text: 'Please review this.',
    html: '',

    headers: [{ name: 'Message-ID', value: `<${messageId}@example.net>` }],
    attachments: [],
    receivedFor: [],
    authentication: null,
    attachmentsDropped: [],
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
      inboundRecipientLogHints(['lost-team@inbound.test', 'ada@gmail.com'], 'inbound.test'),
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

        toAddresses: [],

        text: 'secret body that must not be logged',
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

        toAddresses: [{ email: 'lost-team@inbound.test', name: 'Lost' }],
        text: 'do not log this secret',
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
    payload.text = 'secret retry body';
    await handleInbound({ db: db as never, inboundDomain: 'inbound.test', ...queues }, payload);
    await handleInbound({ db: db as never, inboundDomain: 'inbound.test', ...queues }, payload);

    expect(log.debug).toHaveBeenCalledWith({ teamId: TEAM_ID }, 'inbound email dropped: dedup hit');
    expect(JSON.stringify(log.debug.mock.calls)).not.toContain('secret retry body');
    const rows = await db.select().from(rawEvents).where(eq(rawEvents.source, 'email'));
    expect(rows).toHaveLength(1);
  });
});
