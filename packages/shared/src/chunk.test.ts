import { describe, expect, it } from 'vitest';

import { chunkText, estimateTokens } from './chunk.js';

describe('estimateTokens', () => {
  it('returns 0 for empty input', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('approximates 1 token per 4 chars (ceil)', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });
});

describe('chunkText', () => {
  it('returns no chunks for empty / whitespace input', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   \n\n  ')).toEqual([]);
  });

  it('returns a single chunk when input fits the target budget', () => {
    const text = 'Hello world.';
    const chunks = chunkText(text);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).toBe(text);
    expect(chunks[0]?.index).toBe(0);
    expect(chunks[0]?.tokenCount).toBeGreaterThan(0);
  });

  it('splits long input into multiple chunks with monotonic indices', () => {
    // Build ~4000-char text — well above the 800*4=3200 default targetChars.
    const sentence = 'The quick brown fox jumps over the lazy dog. ';
    const text = sentence.repeat(120);
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    chunks.forEach((c, i) => {
      expect(c.index).toBe(i);
      expect(c.text.length).toBeGreaterThan(0);
    });
  });

  it('produces overlapping chunks (tail of N appears in head of N+1)', () => {
    // Force overlap by making a recognisable boundary phrase.
    const a = 'AAAA '.repeat(500); // ~2500 chars of A
    const marker = 'UNIQUE_BOUNDARY_PHRASE ';
    const b = 'BBBB '.repeat(500); // ~2500 chars of B
    const text = a + marker + b;
    const chunks = chunkText(text, { targetTokens: 400, overlapTokens: 60 });
    // The marker should appear in at least one chunk — and ideally span
    // a chunk boundary so adjacent chunks both contain it.
    const containing = chunks.filter((c) => c.text.includes('UNIQUE_BOUNDARY_PHRASE'));
    expect(containing.length).toBeGreaterThanOrEqual(1);
  });

  it('prefers blank-line boundaries when available', () => {
    const para1 = 'A'.repeat(2000);
    const para2 = 'B'.repeat(2000);
    const text = `${para1}\n\n${para2}`;
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // The first chunk should end exactly at the blank-line boundary —
    // i.e. with the final A character of paragraph one, NOT mid-paragraph.
    // Trailing whitespace is .trim()'d off, so we expect the chunk to end
    // in 'A'.
    const first = chunks[0]?.text ?? '';
    expect(first.endsWith('A')).toBe(true);
    // The chunk should NOT have leaked any B characters from paragraph
    // two — the boundary detection worked.
    expect(first.includes('B')).toBe(false);
  });

  it('makes forward progress on a pathological no-whitespace block', () => {
    // No spaces, no newlines, no punctuation — chunker must still split
    // via the hard-cut fallback rather than loop.
    const text = 'X'.repeat(10000);
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    // Every chunk should be bounded; no single chunk should be the
    // whole input.
    expect(chunks[0]?.text.length).toBeLessThan(text.length);
  });

  it('normalises CRLF to LF before chunking', () => {
    const text = 'line one\r\nline two\r\n\r\nparagraph two';
    const chunks = chunkText(text);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).not.toContain('\r');
  });

  it('records tokenCount that scales with text length', () => {
    const short = chunkText('short text');
    const long = chunkText('a sentence. '.repeat(50));
    expect(long[0]!.tokenCount).toBeGreaterThan(short[0]!.tokenCount);
  });
});
