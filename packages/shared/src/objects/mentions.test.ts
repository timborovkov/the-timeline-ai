import { describe, expect, it } from 'vitest';

import {
  AGENT_DISPLAY_NAME,
  AGENT_INSERT_TOKEN,
  actorDisplayName,
  isAgentMentionToken,
  mentionInsertToken,
  parseMentions,
  type MentionMember,
} from '#src/objects/mentions.js';

const avery: MentionMember = {
  userId: '11111111-1111-1111-1111-111111111111',
  name: 'Avery Timeline',
  email: 'avery@acme.test',
};
const mika: MentionMember = {
  userId: '22222222-2222-2222-2222-222222222222',
  name: 'Mika Product',
  email: 'mika@acme.test',
};
const jordan: MentionMember = {
  userId: '33333333-3333-3333-3333-333333333333',
  name: 'Jordan Hale',
  email: 'jordan@acme.test',
};
const members = [avery, mika, jordan];

describe('parseMentions', () => {
  it('resolves unique first names, compact full names, and email local-parts', () => {
    expect(parseMentions('Need @Avery and @MikaProduct plus @jordan on this.', members)).toEqual([
      {
        kind: 'user',
        userId: avery.userId,
        token: 'Avery',
        startOffset: 5,
        endOffset: 11,
      },
      {
        kind: 'user',
        userId: mika.userId,
        token: 'MikaProduct',
        startOffset: 16,
        endOffset: 28,
      },
      {
        kind: 'user',
        userId: jordan.userId,
        token: 'jordan',
        startOffset: 34,
        endOffset: 41,
      },
    ]);
  });

  it('resolves unique prefixes and ignores unresolved tokens', () => {
    expect(parseMentions('@Ave can you ping @nobody about this?', members)).toEqual([
      {
        kind: 'user',
        userId: avery.userId,
        token: 'Ave',
        startOffset: 0,
        endOffset: 4,
      },
    ]);
  });

  it('records a single agent mention for timeline, bot, or agent aliases', () => {
    expect(parseMentions('@timeline who proposed this? cc @bot @agent', members)).toEqual([
      {
        kind: 'agent',
        token: 'timeline',
        startOffset: 0,
        endOffset: 9,
      },
    ]);
    expect(parseMentions('@TheTimelineBot please look', members)).toEqual([
      {
        kind: 'agent',
        token: 'TheTimelineBot',
        startOffset: 0,
        endOffset: 15,
      },
    ]);
  });

  it('keeps self-mentions and dedupes the same person', () => {
    expect(parseMentions('@Avery I already told @AveryTimeline.', [avery])).toEqual([
      {
        kind: 'user',
        userId: avery.userId,
        token: 'Avery',
        startOffset: 0,
        endOffset: 6,
      },
    ]);
  });

  it('does not resolve an ambiguous first name without a compact token', () => {
    const averyOps: MentionMember = {
      userId: '44444444-4444-4444-4444-444444444444',
      name: 'Avery Ops',
      email: 'avery.ops@acme.test',
    };
    expect(parseMentions('Hey @Avery check this.', [avery, averyOps])).toEqual([]);
    expect(parseMentions('Hey @AveryTimeline check this.', [avery, averyOps])).toEqual([
      {
        kind: 'user',
        userId: avery.userId,
        token: 'AveryTimeline',
        startOffset: 4,
        endOffset: 18,
      },
    ]);
  });
});

describe('isAgentMentionToken', () => {
  it('recognizes compact Timeline Bot tokens and legacy aliases', () => {
    expect(isAgentMentionToken(AGENT_INSERT_TOKEN)).toBe(true);
    expect(isAgentMentionToken('timeline')).toBe(true);
    expect(isAgentMentionToken('bot')).toBe(true);
    expect(isAgentMentionToken('agent')).toBe(true);
    expect(isAgentMentionToken('Casey')).toBe(false);
  });
});

describe('actorDisplayName constants', () => {
  it('names the agent The Timeline Bot', () => {
    expect(AGENT_DISPLAY_NAME).toBe('The Timeline Bot');
    expect(AGENT_INSERT_TOKEN).toBe('TheTimelineBot');
  });
});

describe('mentionInsertToken', () => {
  it('inserts a unique first name, otherwise a compact full name', () => {
    expect(mentionInsertToken(avery, members)).toBe('Avery');
    const averyOps: MentionMember = {
      userId: '44444444-4444-4444-4444-444444444444',
      name: 'Avery Ops',
      email: 'avery.ops@acme.test',
    };
    expect(mentionInsertToken(avery, [avery, averyOps])).toBe('AveryTimeline');
  });
});

describe('actorDisplayName', () => {
  it('uses the member name, then email local-part, then The Timeline Bot for agent authors', () => {
    expect(actorDisplayName(avery.userId, members)).toBe('Avery Timeline');
    expect(actorDisplayName(null, members)).toBe('The Timeline Bot');
    expect(
      actorDisplayName('55555555-5555-5555-5555-555555555555', [
        { userId: '55555555-5555-5555-5555-555555555555', name: '', email: 'sam@acme.test' },
      ]),
    ).toBe('sam');
  });
});
