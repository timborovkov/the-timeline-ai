import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import { inboundEmailSchema } from '#src/email/inbound-schema.js';
import {
  chooseContentText,
  getHeader,
  isAudioAttachment,
  MAX_EMAIL_REFERENCES,
  normalizeMessageId,
  parseForwardedChain,
  parseForwardedFrom,
  parseReferences,
  senderAuthVerdict,
  stripQuotedReply,
} from '#src/email/parser.js';
// Pure-function tests that don't require Postgres. End-to-end ingest is
// verified manually via the Resend test inbox documented in
// docs/setup/resend.md (requires a real Resend account + signed payload).

describe('getHeader', () => {
  it('is case-insensitive', () => {
    const headers = [{ name: 'Message-ID', value: '<a@b>' }];
    expect(getHeader(headers, 'message-id')).toBe('<a@b>');
    expect(getHeader(headers, 'MESSAGE-ID')).toBe('<a@b>');
  });

  it('returns undefined on miss', () => {
    expect(getHeader([{ name: 'X', value: 'y' }], 'subject')).toBeUndefined();
  });
});

describe('normalizeMessageId', () => {
  it('strips angle brackets', () => {
    expect(normalizeMessageId('<abc@host.example>')).toBe('abc@host.example');
  });

  it('returns the inner id even when wrapped in surrounding whitespace and comments', () => {
    expect(normalizeMessageId('  <id@host>  ')).toBe('id@host');
  });

  it('falls back to bare token when no brackets', () => {
    expect(normalizeMessageId('id@host')).toBe('id@host');
  });

  it('returns null on empty / undefined input', () => {
    expect(normalizeMessageId(undefined)).toBeNull();
    expect(normalizeMessageId('')).toBeNull();
    expect(normalizeMessageId('   ')).toBeNull();
  });
});

describe('parseReferences', () => {
  it('parses a chain of bracketed ids', () => {
    expect(parseReferences('<a@x> <b@y> <c@z>')).toEqual(['a@x', 'b@y', 'c@z']);
  });

  it('handles multi-line References folding', () => {
    expect(parseReferences('<a@x>\n <b@y>\r\n\t<c@z>')).toEqual(['a@x', 'b@y', 'c@z']);
  });

  it('bounds bracketed References to the newest unique ids', () => {
    const refs = Array.from({ length: MAX_EMAIL_REFERENCES + 5 }, (_, i) => `<m${i}@x>`);
    refs.push('<m54@x>', '<m53@x>');

    const parsed = parseReferences(refs.join(' '));

    expect(parsed).toHaveLength(MAX_EMAIL_REFERENCES);
    expect(parsed[0]).toBe('m5@x');
    expect(parsed.at(-1)).toBe('m53@x');
    expect(new Set(parsed).size).toBe(MAX_EMAIL_REFERENCES);
  });

  it('bounds bare References and drops oversized ids', () => {
    const oversized = 'x'.repeat(999);
    const refs = Array.from({ length: MAX_EMAIL_REFERENCES + 2 }, (_, i) => `m${i}@x`);

    const parsed = parseReferences([oversized, ...refs].join(' '));

    expect(parsed).toHaveLength(MAX_EMAIL_REFERENCES);
    expect(parsed).not.toContain(oversized);
    expect(parsed[0]).toBe('m2@x');
  });

  it('returns empty array on undefined / empty input', () => {
    expect(parseReferences(undefined)).toEqual([]);
    expect(parseReferences('')).toEqual([]);
  });
});

describe('isAudioAttachment', () => {
  it('routes by content-type first', () => {
    expect(isAudioAttachment('voice.bin', 'audio/mpeg')).toBe(true);
    expect(isAudioAttachment('voice.bin', 'audio/m4a')).toBe(true);
  });

  it('does NOT trust the filename when content-type disagrees', () => {
    // MIME-spoofing defense: a zip renamed to .mp3 must not be sent to the
    // transcribe pipeline.
    expect(isAudioAttachment('evil.mp3', 'application/zip')).toBe(false);
    expect(isAudioAttachment('evil.mp3', 'text/plain')).toBe(false);
  });

  it('falls back to extension only for application/octet-stream', () => {
    expect(isAudioAttachment('memo.m4a', 'application/octet-stream')).toBe(true);
    expect(isAudioAttachment('memo.txt', 'application/octet-stream')).toBe(false);
  });

  it('handles content-type with charset suffix', () => {
    expect(isAudioAttachment('a.wav', 'audio/wav; charset=binary')).toBe(true);
  });
});

describe('stripQuotedReply', () => {
  it('cuts at the "On <date>, <addr> wrote:" line', () => {
    const text = [
      'Sounds good — let me get back to you Thursday.',
      '',
      'On Tue, May 19, 2026 at 11:14, John <john@apple.com> wrote:',
      '> Hey Tim,',
      '> Wanted to chat about licensing.',
    ].join('\n');
    expect(stripQuotedReply(text)).toBe('Sounds good — let me get back to you Thursday.');
  });

  it('cuts at the Outlook separator', () => {
    const text = [
      'My reply',
      '',
      '--- Original Message ---',
      'from: John',
      'lots of quoted text',
    ].join('\n');
    expect(stripQuotedReply(text)).toBe('My reply');
  });

  it('drops trailing all-`>` quoted blocks', () => {
    expect(stripQuotedReply('a\nb\n> quoted\n> more')).toBe('a\nb');
  });

  it('returns empty string when input is empty', () => {
    expect(stripQuotedReply('')).toBe('');
  });
});

describe('parseForwardedFrom', () => {
  const gmail = [
    "Here's the thread on the Apple licensing call.",
    '',
    '---------- Forwarded message ---------',
    'from: John Ternus <john.ternus@apple.com>',
    'Date: Tue, May 19, 2026 at 11:14',
    'subject: Re: SaaS licensing Q2',
    'to: Tim <tim@team.example>',
    '',
    'Tim — we should sync on terms next week.',
  ].join('\n');

  it('parses the Gmail forwarded-header variant', () => {
    expect(parseForwardedFrom({ subject: 'Fwd: SaaS licensing Q2', textBody: gmail })).toEqual({
      email: 'john.ternus@apple.com',
      name: 'John Ternus',
    });
  });

  it('parses the Apple Mail "Begin forwarded message:" variant', () => {
    const apple = [
      'Forwarding for the team.',
      '',
      'Begin forwarded message:',
      '',
      'from: Sarah <sarah@example.com>',
      'subject: Vendor renewal',
    ].join('\n');
    expect(parseForwardedFrom({ subject: 'Fwd: Vendor renewal', textBody: apple })).toEqual({
      email: 'sarah@example.com',
      name: 'Sarah',
    });
  });

  it('parses the Outlook variant when subject signals Fwd:', () => {
    const outlook = [
      'See below.',
      '',
      'from: Procurement <procurement@vendor.example>',
      'Sent: Wednesday, May 13, 2026 3:14 PM',
      'to: Tim',
      'subject: Renewal quote',
    ].join('\n');
    expect(parseForwardedFrom({ subject: 'FW: Renewal quote', textBody: outlook })).toEqual({
      email: 'procurement@vendor.example',
      name: 'Procurement',
    });
  });

  it('does not false-positive on a plain reply that contains a "from:" sig line', () => {
    const reply = ['Yes, agreed.', '', 'from: Tim', 'Tim Borovkov · CTO'].join('\n');
    expect(parseForwardedFrom({ subject: 'Re: budget', textBody: reply })).toBeNull();
  });

  it('returns null when no forwarded block is detected', () => {
    expect(parseForwardedFrom({ subject: 'hello', textBody: 'just a quick note' })).toBeNull();
  });

  it('returns null on empty body', () => {
    expect(parseForwardedFrom({ subject: 'Fwd: anything', textBody: '' })).toBeNull();
  });
});

describe('parseForwardedChain', () => {
  it('parses nested Gmail-style forwarded messages with bodies', () => {
    const text = [
      'Team, see the customer thread below.',
      '',
      '---------- Forwarded message ---------',
      'from: Ada Lovelace <ada@example.com>',
      'Date: Wed, Jun 17, 2026 at 2:15 PM',
      'subject: Re: Launch checklist',
      'to: Tim <tim@team.example>',
      '',
      'The launch checklist is approved.',
      '',
      '---------- Forwarded message ---------',
      'from: Grace Hopper <grace@example.com>',
      'Date: Wed, Jun 17, 2026 at 1:03 PM',
      'subject: Launch checklist',
      'to: Ada <ada@example.com>',
      '',
      'Please confirm the rollout window.',
    ].join('\n');

    expect(parseForwardedChain({ subject: 'Fwd: Launch checklist', textBody: text })).toEqual([
      {
        from: { email: 'ada@example.com', name: 'Ada Lovelace' },
        date: 'Wed, Jun 17, 2026 at 2:15 PM',
        subject: 'Re: Launch checklist',
        to: [{ email: 'tim@team.example', name: 'Tim' }],
        body: 'The launch checklist is approved.',
      },
      {
        from: { email: 'grace@example.com', name: 'Grace Hopper' },
        date: 'Wed, Jun 17, 2026 at 1:03 PM',
        subject: 'Launch checklist',
        to: [{ email: 'ada@example.com', name: 'Ada' }],
        body: 'Please confirm the rollout window.',
      },
    ]);
  });

  it('parses Outlook-style forwarded chains when the subject is forwarded', () => {
    const text = [
      'FYI',
      '',
      'from: Procurement <procurement@vendor.example>',
      'Sent: Wednesday, June 17, 2026 4:05 PM',
      'to: Tim <tim@team.example>, ops@team.example',
      'cc: Legal <legal@team.example>',
      'subject: Renewal quote',
      '',
      'The renewal quote expires Friday.',
    ].join('\n');

    expect(parseForwardedChain({ subject: 'FW: Renewal quote', textBody: text })).toEqual([
      {
        from: { email: 'procurement@vendor.example', name: 'Procurement' },
        date: 'Wednesday, June 17, 2026 4:05 PM',
        subject: 'Renewal quote',
        to: [{ email: 'tim@team.example', name: 'Tim' }, { email: 'ops@team.example' }],
        cc: [{ email: 'legal@team.example', name: 'Legal' }],
        body: 'The renewal quote expires Friday.',
      },
    ]);
  });

  it('does not add Outlook-looking signatures when explicit forwarded markers exist', () => {
    const text = [
      'Team, see below.',
      '',
      '---------- Forwarded message ---------',
      'from: Ada Lovelace <ada@example.com>',
      'Date: Wed, Jun 17, 2026 at 2:15 PM',
      'subject: Launch checklist',
      'to: Tim <tim@team.example>',
      '',
      'The launch checklist is approved.',
      '',
      'from: Tim Borovkov <tim@team.example>',
      'Sent: Wednesday, June 17, 2026 5:05 PM',
      'to: Operations <ops@team.example>',
      'subject: Signature footer',
    ].join('\n');

    expect(parseForwardedChain({ subject: 'Fwd: Launch checklist', textBody: text })).toEqual([
      {
        from: { email: 'ada@example.com', name: 'Ada Lovelace' },
        date: 'Wed, Jun 17, 2026 at 2:15 PM',
        subject: 'Launch checklist',
        to: [{ email: 'tim@team.example', name: 'Tim' }],
        body: [
          'The launch checklist is approved.',
          '',
          'from: Tim Borovkov <tim@team.example>',
          'Sent: Wednesday, June 17, 2026 5:05 PM',
          'to: Operations <ops@team.example>',
          'subject: Signature footer',
        ].join('\n'),
      },
    ]);
  });

  it('keeps an outer Outlook-style forward before nested explicit markers', () => {
    const text = [
      'FYI',
      '',
      'from: Procurement <procurement@vendor.example>',
      'Sent: Wednesday, June 17, 2026 4:05 PM',
      'to: Tim <tim@team.example>',
      'subject: Renewal quote',
      '',
      'Please review the attached context.',
      '',
      '---------- Forwarded message ---------',
      'from: Ada Lovelace <ada@example.com>',
      'Date: Wed, Jun 17, 2026 at 2:15 PM',
      'subject: Launch checklist',
      'to: Procurement <procurement@vendor.example>',
      '',
      'The launch checklist is approved.',
    ].join('\n');

    expect(parseForwardedChain({ subject: 'FW: Renewal quote', textBody: text })).toEqual([
      {
        from: { email: 'procurement@vendor.example', name: 'Procurement' },
        date: 'Wednesday, June 17, 2026 4:05 PM',
        subject: 'Renewal quote',
        to: [{ email: 'tim@team.example', name: 'Tim' }],
        body: 'Please review the attached context.',
      },
      {
        from: { email: 'ada@example.com', name: 'Ada Lovelace' },
        date: 'Wed, Jun 17, 2026 at 2:15 PM',
        subject: 'Launch checklist',
        to: [{ email: 'procurement@vendor.example', name: 'Procurement' }],
        body: 'The launch checklist is approved.',
      },
    ]);
  });

  it('does not treat ordinary reply text as a forwarded chain', () => {
    expect(
      parseForwardedChain({
        subject: 'Re: Launch checklist',
        textBody: 'Yes, agreed.\n\nFrom: Tim\nTim Borovkov',
      }),
    ).toEqual([]);
  });
});

describe('chooseContentText', () => {
  function parse(input: Record<string, unknown>) {
    return inboundEmailSchema.parse({ providerId: 'm@x', ...input });
  }

  it('strips quoted replies locally', () => {
    const payload = parse({
      text: 'just the reply\n\nOn ... wrote:\n> old',
    });
    expect(chooseContentText(payload)).toBe('just the reply');
  });

  it('keeps forwarded chain content visible with a forwarder intro', () => {
    const payload = parse({
      subject: 'Fwd: Launch checklist',

      text: [
        'Team, see below.',
        '',
        '---------- Forwarded message ---------',
        'from: Ada Lovelace <ada@example.com>',
        'Date: Wed, Jun 17, 2026 at 2:15 PM',
        'subject: Re: Launch checklist',
        'to: Tim <tim@team.example>',
        '',
        'The launch checklist is approved.',
      ].join('\n'),
    });

    expect(chooseContentText(payload)).toContain('Team, see below.');
    expect(chooseContentText(payload)).toContain('From: Ada Lovelace <ada@example.com>');
    expect(chooseContentText(payload)).toContain('The launch checklist is approved.');
  });

  it('does not duplicate forwarded blocks in original text', () => {
    const payload = parse({
      subject: 'Fwd: Launch checklist',
      text: [
        'Team, see below.',
        '',
        '---------- Forwarded message ---------',
        'from: Ada Lovelace <ada@example.com>',
        'Date: Wed, Jun 17, 2026 at 2:15 PM',
        'subject: Launch checklist',
        'to: Tim <tim@team.example>',
        '',
        'The launch checklist is approved.',
      ].join('\n'),
    });

    const content = chooseContentText(payload);
    expect(content).toContain('Team, see below.');
    expect(content.match(/From: Ada Lovelace <ada@example.com>/g)).toHaveLength(1);
    expect(content.match(/The launch checklist is approved\./g)).toHaveLength(1);
  });

  it('keeps the forwarder intro for Outlook-style forwards ', () => {
    const payload = parse({
      subject: 'FW: Renewal quote',

      text: [
        'FYI for renewal planning.',
        '',
        'from: Procurement <procurement@vendor.example>',
        'Sent: Wednesday, June 17, 2026 4:05 PM',
        'to: Tim <tim@team.example>',
        'subject: Renewal quote',
        '',
        'The renewal quote expires Friday.',
      ].join('\n'),
    });

    expect(chooseContentText(payload)).toContain('FYI for renewal planning.');
    expect(chooseContentText(payload)).toContain('From: Procurement <procurement@vendor.example>');
    expect(chooseContentText(payload)).toContain('The renewal quote expires Friday.');
  });

  it('falls through to stripQuotedReply(text) ', () => {
    const payload = parse({
      text: 'fresh\n\nOn Tue, May 19, 2026 at 11:14, John wrote:\n> old',
    });
    expect(chooseContentText(payload)).toBe('fresh');
  });

  it('falls through to HTML when text is empty', () => {
    const payload = parse({ text: '', html: '<p>hello <b>world</b></p>' });
    expect(chooseContentText(payload)).toContain('hello');
  });

  it('returns empty string when nothing usable', () => {
    expect(chooseContentText(parse({}))).toBe('');
  });

  it('falls through to HTML when text strips to empty', () => {
    // The text is 100% a quoted reply chain — stripQuotedReply cuts it
    // all and returns ''. We must NOT return that empty string; the HTML
    // body has the real content.
    const payload = parse({
      text: 'On Tue, May 19, 2026 at 11:14, John wrote:\n> the whole body is quoted',
      html: '<p>The actual message lives only in HTML</p>',
    });
    expect(chooseContentText(payload)).toContain('actual message lives only in HTML');
  });
});

describe('senderAuthVerdict', () => {
  it('preserves absent results and requires an SPF or DKIM pass when present', () => {
    expect(senderAuthVerdict(null)).toBe('absent');
    expect(senderAuthVerdict({ spf: 'fail', dkim: 'pass', dmarc: 'pass' })).toBe('pass');
    expect(senderAuthVerdict({ spf: 'pass', dkim: 'fail', dmarc: 'fail' })).toBe('pass');
    expect(senderAuthVerdict({ spf: 'fail', dkim: 'fail', dmarc: 'fail' })).toBe('fail');
    expect(senderAuthVerdict({ spf: 'unknown', dkim: 'gray', dmarc: 'unknown' })).toBe('fail');
  });
});
