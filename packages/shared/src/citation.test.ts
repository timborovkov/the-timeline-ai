import { describe, expect, it } from 'vitest';

import { parseCitations } from './citation.js';

const EV = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const ENT = '11111111-2222-3333-4444-555555555555';
const DOC = '66666666-7777-8888-9999-aaaaaaaaaaaa';
const CHUNK = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';

describe('parseCitations', () => {
  it('returns a single text part for input with no citations', () => {
    expect(parseCitations('plain text answer')).toEqual([
      { type: 'text', value: 'plain text answer' },
    ]);
  });

  it('parses an [ev:<uuid>] citation', () => {
    const parts = parseCitations(`see [ev:${EV}] for context`);
    expect(parts).toEqual([
      { type: 'text', value: 'see ' },
      { type: 'ev', value: EV },
      { type: 'text', value: ' for context' },
    ]);
  });

  it('parses an [ent:<uuid>] citation', () => {
    const parts = parseCitations(`owner is [ent:${ENT}].`);
    expect(parts).toEqual([
      { type: 'text', value: 'owner is ' },
      { type: 'ent', value: ENT },
      { type: 'text', value: '.' },
    ]);
  });

  it('parses a [doc:<uuid>#v<n>:chunk:<uuid>] citation with version + chunk', () => {
    const parts = parseCitations(`per the contract [doc:${DOC}#v2:chunk:${CHUNK}].`);
    expect(parts).toEqual([
      { type: 'text', value: 'per the contract ' },
      { type: 'doc', documentId: DOC, version: '2', chunkId: CHUNK },
      { type: 'text', value: '.' },
    ]);
  });

  it('parses multiple citations of mixed kinds in one answer', () => {
    const text = `Owner [ent:${ENT}] uploaded [doc:${DOC}#v1:chunk:${CHUNK}] referencing [ev:${EV}].`;
    const parts = parseCitations(text);
    const kinds = parts.map((p) => p.type);
    expect(kinds).toContain('ent');
    expect(kinds).toContain('doc');
    expect(kinds).toContain('ev');
    // No citation should be dropped or duplicated.
    expect(parts.filter((p) => p.type !== 'text')).toHaveLength(3);
  });

  it('rejects malformed citations (treats them as plain text)', () => {
    // Missing colon, wrong prefix, wrong UUID length, truncated doc marker.
    const inputs = [
      `[ev ${EV}]`,
      `[xyz:${EV}]`,
      `[ev:not-a-uuid]`,
      `[doc:${DOC}#v1:chunk:not-a-uuid]`,
      `[doc:${DOC}:chunk:${CHUNK}]`,
    ];
    for (const text of inputs) {
      const parts = parseCitations(text);
      // The whole input should round-trip as text (no citation parts).
      const nonText = parts.filter((p) => p.type !== 'text');
      expect(nonText).toEqual([]);
    }
  });

  it('is case-insensitive on the citation prefix', () => {
    const parts = parseCitations(`[EV:${EV}] and [Ent:${ENT}]`);
    expect(parts.find((p) => p.type === 'ev')).toBeDefined();
    expect(parts.find((p) => p.type === 'ent')).toBeDefined();
  });

  it('handles repeated invocation without leaking regex /g state', () => {
    // The /g flags on the internal regexes carry lastIndex between calls.
    // Calling parseCitations twice on the same input must produce identical
    // results.
    const text = `[ev:${EV}] [doc:${DOC}#v1:chunk:${CHUNK}]`;
    const first = parseCitations(text);
    const second = parseCitations(text);
    expect(second).toEqual(first);
    // A third call interleaved with a non-citation string must also be stable.
    expect(parseCitations('no citations here')).toEqual([
      { type: 'text', value: 'no citations here' },
    ]);
    expect(parseCitations(text)).toEqual(first);
  });

  it('does NOT match document citations missing the version segment', () => {
    // Older citation shape [doc:<id>:chunk:<id>] must not parse — the
    // version is load-bearing for the link target.
    const parts = parseCitations(`[doc:${DOC}:chunk:${CHUNK}]`);
    expect(parts.filter((p) => p.type !== 'text')).toEqual([]);
  });

  it('treats a doc citation with v0 / multi-digit version as valid', () => {
    const parts = parseCitations(`[doc:${DOC}#v17:chunk:${CHUNK}]`);
    const doc = parts.find((p) => p.type === 'doc');
    expect(doc).toEqual({ type: 'doc', documentId: DOC, version: '17', chunkId: CHUNK });
  });
});
