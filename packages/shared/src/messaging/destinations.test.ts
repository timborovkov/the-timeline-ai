import { describe, expect, it } from 'vitest';

import {
  digestDestinationDedupeKey,
  digestDestinationLabel,
  isPersonalDigestDestination,
  isSharedDigestDestination,
  parseAddDigestDestinationInput,
  personalDigestDestinations,
  sharedDigestDestinations,
} from '#src/messaging/destinations.js';

describe('digest destinations', () => {
  it('classifies personal fan-out versus shared chat destinations', () => {
    expect(isPersonalDigestDestination('email_members')).toBe(true);
    expect(isPersonalDigestDestination('slack_dm_members')).toBe(true);
    expect(isPersonalDigestDestination('telegram_dm_members')).toBe(true);
    expect(isSharedDigestDestination('slack_channel')).toBe(true);
    expect(isSharedDigestDestination('telegram_chat')).toBe(true);
    expect(isPersonalDigestDestination('slack_channel')).toBe(false);
  });

  it('requires a chat target only for shared destinations', () => {
    expect(parseAddDigestDestinationInput({ kind: 'email_members' })).toEqual({
      ok: true,
      value: { kind: 'email_members' },
    });
    expect(parseAddDigestDestinationInput({ kind: 'slack_channel' }).ok).toBe(false);
    expect(
      parseAddDigestDestinationInput({
        kind: 'slack_channel',
        targetId: 'C123',
        label: '#general',
      }),
    ).toEqual({
      ok: true,
      value: { kind: 'slack_channel', targetId: 'C123', label: '#general' },
    });
    expect(parseAddDigestDestinationInput({ kind: 'email_members', targetId: 'C123' }).ok).toBe(
      false,
    );
  });

  it('keeps email delivery keys stable and namespaces other destinations', () => {
    expect(
      digestDestinationDedupeKey({
        scope: 'member',
        digestId: 'digest-1',
        teamId: 'team-1',
        windowEnd: '2026-06-14T12:00:00.000Z',
        destination: { kind: 'email_members', targetId: null },
      }),
    ).toBe('daily_digest:digest-1');
    expect(
      digestDestinationDedupeKey({
        scope: 'member',
        digestId: 'digest-1',
        teamId: 'team-1',
        windowEnd: '2026-06-14T12:00:00.000Z',
        destination: { kind: 'telegram_dm_members', targetId: null },
      }),
    ).toBe('daily_digest:digest-1:telegram_dm_members');
    expect(
      digestDestinationDedupeKey({
        scope: 'workspace',
        teamId: 'team-1',
        windowEnd: '2026-06-14T12:00:00.000Z',
        destination: { kind: 'slack_channel', targetId: 'C123' },
      }),
    ).toBe('daily_digest:workspace:team-1:2026-06-14T12:00:00.000Z:slack_channel:C123');
  });

  it('labels destinations for settings and splits personal from shared lists', () => {
    const destinations = [
      {
        id: '1',
        teamId: 'team-1',
        kind: 'email_members' as const,
        targetId: null,
        label: null,
        enabled: true,
      },
      {
        id: '2',
        teamId: 'team-1',
        kind: 'slack_channel' as const,
        targetId: 'C123',
        label: '#general',
        enabled: true,
      },
    ];
    const email = destinations.find((row) => row.kind === 'email_members');
    const slack = destinations.find((row) => row.kind === 'slack_channel');
    expect(email ? digestDestinationLabel(email) : null).toBe('Email every member');
    expect(slack ? digestDestinationLabel(slack) : null).toBe('Slack #general');
    expect(personalDigestDestinations(destinations).map((row) => row.kind)).toEqual([
      'email_members',
    ]);
    expect(sharedDigestDestinations(destinations).map((row) => row.kind)).toEqual([
      'slack_channel',
    ]);
  });
});
