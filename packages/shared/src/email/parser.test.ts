import { describe, expect, it } from 'vitest';

import {
  chooseContentText,
  getHeader,
  isAudioAttachment,
  normalizeMessageId,
  parseAuthenticationResults,
  parseForwardedFrom,
  parseReferences,
  senderAuthVerdict,
  stripQuotedReply,
} from '#src/email/parser.js';
import { postmarkInboundSchema } from '#src/email/postmark-schema.js';
import { verifyPostmarkBasicAuth } from '#src/email/secret.js';

// Pure-function tests that don't require Postgres. End-to-end ingest is
// verified manually via the Postmark test inbox documented in
// docs/setup/postmark.md (requires a real Postmark account + signed payload).

describe('getHeader', () => {
  it('is case-insensitive', () => {
    const headers = [{ Name: 'Message-ID', Value: '<a@b>' }];
    expect(getHeader(headers, 'message-id')).toBe('<a@b>');
    expect(getHeader(headers, 'MESSAGE-ID')).toBe('<a@b>');
  });

  it('returns undefined on miss', () => {
    expect(getHeader([{ Name: 'X', Value: 'y' }], 'Subject')).toBeUndefined();
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
      'From: John',
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
    'From: John Ternus <john.ternus@apple.com>',
    'Date: Tue, May 19, 2026 at 11:14',
    'Subject: Re: SaaS licensing Q2',
    'To: Tim <tim@team.example>',
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
      'From: Sarah <sarah@example.com>',
      'Subject: Vendor renewal',
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
      'From: Procurement <procurement@vendor.example>',
      'Sent: Wednesday, May 13, 2026 3:14 PM',
      'To: Tim',
      'Subject: Renewal quote',
    ].join('\n');
    expect(parseForwardedFrom({ subject: 'FW: Renewal quote', textBody: outlook })).toEqual({
      email: 'procurement@vendor.example',
      name: 'Procurement',
    });
  });

  it('does not false-positive on a plain reply that contains a "From:" sig line', () => {
    const reply = ['Yes, agreed.', '', 'From: Tim', 'Tim Borovkov · CTO'].join('\n');
    expect(parseForwardedFrom({ subject: 'Re: budget', textBody: reply })).toBeNull();
  });

  it('returns null when no forwarded block is detected', () => {
    expect(parseForwardedFrom({ subject: 'hello', textBody: 'just a quick note' })).toBeNull();
  });

  it('returns null on empty body', () => {
    expect(parseForwardedFrom({ subject: 'Fwd: anything', textBody: '' })).toBeNull();
  });
});

describe('chooseContentText', () => {
  function parse(input: Record<string, unknown>) {
    return postmarkInboundSchema.parse({ MessageID: 'm@x', ...input });
  }

  it('prefers StrippedTextReply when present', () => {
    const payload = parse({
      StrippedTextReply: 'just the reply',
      TextBody: 'just the reply\n\nOn ... wrote:\n> old',
    });
    expect(chooseContentText(payload)).toBe('just the reply');
  });

  it('falls through to stripQuotedReply(TextBody) when StrippedTextReply is empty', () => {
    const payload = parse({
      StrippedTextReply: '',
      TextBody: 'fresh\n\nOn Tue, May 19, 2026 at 11:14, John wrote:\n> old',
    });
    expect(chooseContentText(payload)).toBe('fresh');
  });

  it('falls through to HTML when text is empty', () => {
    const payload = parse({ TextBody: '', HtmlBody: '<p>hello <b>world</b></p>' });
    expect(chooseContentText(payload)).toContain('hello');
  });

  it('returns empty string when nothing usable', () => {
    expect(chooseContentText(parse({}))).toBe('');
  });

  it('falls through to HTML when TextBody strips to empty', () => {
    // The TextBody is 100% a quoted reply chain — stripQuotedReply cuts it
    // all and returns ''. We must NOT return that empty string; the HTML
    // body has the real content.
    const payload = parse({
      StrippedTextReply: '',
      TextBody: 'On Tue, May 19, 2026 at 11:14, John wrote:\n> the whole body is quoted',
      HtmlBody: '<p>The actual message lives only in HTML</p>',
    });
    expect(chooseContentText(payload)).toContain('actual message lives only in HTML');
  });
});

describe('parseAuthenticationResults + senderAuthVerdict', () => {
  function headers(value?: string) {
    return value ? [{ Name: 'Authentication-Results', Value: value }] : [];
  }

  const TRUSTED = ['mx.postmark.com'];

  it('returns null when header absent', () => {
    expect(parseAuthenticationResults(headers(), TRUSTED)).toBeNull();
    expect(senderAuthVerdict(null)).toBe('absent');
  });

  it('returns null when allowlist is empty (dev mode)', () => {
    const h = 'mx.postmark.com; spf=pass; dkim=pass';
    expect(parseAuthenticationResults(headers(h), [])).toBeNull();
  });

  it('parses standard Postmark-style header', () => {
    const h =
      'mx.postmark.com; spf=pass smtp.mailfrom=user@example.com; dkim=pass header.d=example.com; dmarc=pass';
    const r = parseAuthenticationResults(headers(h), TRUSTED);
    expect(r?.spf).toBe('pass');
    expect(r?.dkim).toBe('pass');
    expect(r?.dmarc).toBe('pass');
    expect(senderAuthVerdict(r)).toBe('pass');
  });

  it('REJECTS attacker-injected AR header with untrusted authserv-id', () => {
    // The defining spoof: attacker crafts a MIME header in the email body
    // claiming spf=pass dkim=pass, but signs it with their own hostname.
    const h = 'attacker.example.com; spf=pass; dkim=pass; dmarc=pass';
    expect(parseAuthenticationResults(headers(h), TRUSTED)).toBeNull();
  });

  it('PICKS the trusted header even when attacker-injected one appears first', () => {
    const hs = [
      { Name: 'Authentication-Results', Value: 'attacker.example; spf=pass; dkim=pass' },
      { Name: 'Authentication-Results', Value: 'mx.postmark.com; spf=fail; dkim=fail' },
    ];
    const r = parseAuthenticationResults(hs, TRUSTED);
    expect(r?.authservId).toBe('mx.postmark.com');
    expect(r?.spf).toBe('fail');
    expect(senderAuthVerdict(r)).toBe('fail');
  });

  it('accepts as pass when only DKIM passes (forward scenario)', () => {
    const h = 'mx.postmark.com; spf=fail; dkim=pass; dmarc=fail';
    expect(senderAuthVerdict(parseAuthenticationResults(headers(h), TRUSTED))).toBe('pass');
  });

  it('accepts as pass when only SPF passes', () => {
    const h = 'mx.postmark.com; spf=pass; dkim=fail; dmarc=fail';
    expect(senderAuthVerdict(parseAuthenticationResults(headers(h), TRUSTED))).toBe('pass');
  });

  it('returns fail when neither SPF nor DKIM passed (spoof signal)', () => {
    const h = 'mx.postmark.com; spf=fail; dkim=fail; dmarc=fail';
    expect(senderAuthVerdict(parseAuthenticationResults(headers(h), TRUSTED))).toBe('fail');
  });

  it('returns fail on neutral/softfail/none combinations', () => {
    const h = 'mx.postmark.com; spf=softfail; dkim=none';
    expect(senderAuthVerdict(parseAuthenticationResults(headers(h), TRUSTED))).toBe('fail');
  });

  it('is case-insensitive on authserv-id and verb', () => {
    const h = 'MX.Postmark.COM; SPF=Pass; DKIM=Pass';
    expect(senderAuthVerdict(parseAuthenticationResults(headers(h), TRUSTED))).toBe('pass');
  });

  it('strips RFC-5322 comments in authserv-id', () => {
    const h = 'mx.postmark.com (Postmark inbound); spf=pass; dkim=pass';
    expect(parseAuthenticationResults(headers(h), TRUSTED)?.spf).toBe('pass');
  });
});

describe('verifyPostmarkBasicAuth', () => {
  function header(user: string, pass: string): string {
    return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
  }

  it('rejects missing inputs', () => {
    expect(verifyPostmarkBasicAuth(null, 'secret')).toBe(false);
    expect(verifyPostmarkBasicAuth(header('a', 'b'), null)).toBe(false);
    expect(verifyPostmarkBasicAuth('', 'secret')).toBe(false);
  });

  it('rejects malformed Authorization header', () => {
    expect(verifyPostmarkBasicAuth('Bearer xyz', 'secret')).toBe(false);
    expect(verifyPostmarkBasicAuth('Basic not-base64!@', 'secret')).toBe(false);
  });

  it('accepts the secret in the password slot', () => {
    const secret = 'a'.repeat(32);
    expect(verifyPostmarkBasicAuth(header('postmark', secret), secret)).toBe(true);
  });

  it('accepts the secret in the user slot', () => {
    const secret = 'b'.repeat(32);
    expect(verifyPostmarkBasicAuth(header(secret, ''), secret)).toBe(true);
  });

  it('rejects mismatched secret', () => {
    expect(verifyPostmarkBasicAuth(header('postmark', 'wrong'), 'right')).toBe(false);
  });

  it('is length-safe (different-length inputs never throw)', () => {
    expect(verifyPostmarkBasicAuth(header('postmark', 'short'), 'a'.repeat(64))).toBe(false);
  });
});
