/**
 * Phase 9 — text chunker for document processing. Token counts are
 * estimated as `ceil(chars / 4)` to avoid pulling a tokenizer dependency
 * for what is fundamentally a budgeting hint, not a precise metric. The
 * embed worker enforces real model limits at upsert time; this only sizes
 * chunks roughly so we don't spam the embedding API with one-sentence
 * vectors or blow out the context window with five-page slabs.
 *
 * The chunker prefers natural breakpoints in order: blank lines >
 * sentence-ending punctuation > whitespace > hard cut. Overlap is taken
 * from the tail of the previous chunk so chunks share a small ramp and
 * retrieval doesn't lose information that straddles a boundary.
 */

const CHARS_PER_TOKEN = 4;

export interface ChunkOptions {
  /** Target chunk size in tokens. Defaults to ~800. */
  targetTokens?: number;
  /** Overlap between consecutive chunks in tokens. Defaults to ~120. */
  overlapTokens?: number;
}

export interface TextChunk {
  index: number;
  text: string;
  /** Estimated token count — see CHARS_PER_TOKEN comment. */
  tokenCount: number;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function chunkText(input: string, opts: ChunkOptions = {}): TextChunk[] {
  const targetTokens = opts.targetTokens ?? 800;
  const overlapTokens = opts.overlapTokens ?? 120;
  const targetChars = targetTokens * CHARS_PER_TOKEN;
  const overlapChars = overlapTokens * CHARS_PER_TOKEN;

  const cleaned = input.replace(/\r\n/g, '\n').trim();
  if (!cleaned) return [];

  if (cleaned.length <= targetChars) {
    return [{ index: 0, text: cleaned, tokenCount: estimateTokens(cleaned) }];
  }

  const chunks: TextChunk[] = [];
  let cursor = 0;
  let index = 0;

  while (cursor < cleaned.length) {
    const remaining = cleaned.length - cursor;
    if (remaining <= targetChars) {
      const piece = cleaned.slice(cursor).trim();
      if (piece) chunks.push({ index: index++, text: piece, tokenCount: estimateTokens(piece) });
      break;
    }

    const hardEnd = cursor + targetChars;
    // Search for a natural break in the back half of the window. Prefer the
    // latest blank line, then the latest sentence boundary, then any
    // whitespace. Falling back to a hard cut is the last resort.
    const windowStart = cursor + Math.floor(targetChars * 0.5);
    const window = cleaned.slice(windowStart, hardEnd);

    let cut = -1;
    const blank = window.lastIndexOf('\n\n');
    if (blank >= 0) cut = windowStart + blank + 2;
    if (cut < 0) {
      const sentence = window.search(/[.!?]\s(?=[^.!?]*$)/);
      if (sentence >= 0) cut = windowStart + sentence + 2;
    }
    if (cut < 0) {
      const ws = window.lastIndexOf(' ');
      if (ws >= 0) cut = windowStart + ws + 1;
    }
    if (cut <= cursor) cut = hardEnd;

    const piece = cleaned.slice(cursor, cut).trim();
    if (piece) chunks.push({ index: index++, text: piece, tokenCount: estimateTokens(piece) });

    // Advance with overlap. We move the cursor forward by (cut - overlap)
    // so the next chunk's leading `overlapChars` characters are the prior
    // chunk's tail.
    const advance = Math.max(1, cut - cursor - overlapChars);
    cursor += advance;
  }

  return chunks;
}
