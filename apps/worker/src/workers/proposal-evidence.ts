// Keep character offsets in the original source. Only typographical variants of
// the same punctuation are interchangeable when locating a proposed name.
export function evidenceNamePattern(names: readonly string[]): RegExp {
  const unspaced =
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
  const word = '[\\p{L}\\p{M}\\p{N}]';
  const alternatives = names.filter(Boolean).map((name) => {
    const start = unspaced.test(/^./u.exec(name)?.[0] ?? '') ? '' : `(?<!${word})`;
    const end = unspaced.test(/.$/u.exec(name)?.[0] ?? '') ? '' : `(?!${word})`;
    const literal = name
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/['‘’]/g, "['‘’]")
      .replace(/[-‐‑‒–—]/g, '[-‐‑‒–—]');
    return start + literal + end;
  });
  return new RegExp(alternatives.join('|') || '(?!)', 'giu');
}

interface EvidenceSource {
  rawEventId: string;
  text: string;
  factStatements?: string[];
}

/** Distribute the prompt across linked sources so a few long or recent notes
 * cannot consume it. Every excerpt is one contiguous slice of the original. */
export function repairEvidencePassages(
  evidence: EvidenceSource[],
  names: string[],
  otherEndpointNames?: string[],
): EvidenceSource[] {
  const pattern = evidenceNamePattern(names);
  // A relationship citation must identify both endpoints in one quote (at most
  // 1,000 characters), even when the extracted fact paraphrases that quote.
  const endpoint = otherEndpointNames && evidenceNamePattern(otherEndpointNames);
  const near = '[\\s\\S]{0,1000}?';
  const pair =
    endpoint &&
    new RegExp(
      `(?:${pattern.source})${near}(?:${endpoint.source})|(?:${endpoint.source})${near}(?:${pattern.source})`,
      'giu',
    );
  const sources = evidence.flatMap((source) => {
    pattern.lastIndex = 0;
    const first = pattern.exec(source.text);
    return first ? [{ ...source, first: first.index }] : [];
  });
  const budget = Math.min(6000, Math.floor(48000 / Math.max(1, sources.length)));
  return sources.flatMap(({ rawEventId, text, first, factStatements }) => {
    if (text.length <= budget) return [{ rawEventId, text }];
    let firstFocus: number | undefined;
    let lastFocus = first;
    const focus = pair ?? pattern;
    // Retain separated occurrences when they fit the budget. For dense sources
    // sample across the length of the source instead of taking only early hits.
    const capacity = Math.floor(budget / 1000);
    const occurrences: number[] = [];
    const regions = new Map<number, number>();
    let lastOccurrence = -Infinity;
    focus.lastIndex = 0;
    for (const match of text.matchAll(focus)) {
      lastFocus = pair ? match.index + Math.floor(match[0].length / 2) : match.index;
      firstFocus ??= lastFocus;
      if (lastFocus - lastOccurrence >= 1000) {
        if (occurrences.length <= capacity) occurrences.push(lastFocus);
        regions.set(Math.floor((lastFocus / text.length) * capacity), lastFocus);
        lastOccurrence = lastFocus;
      }
    }
    const positions = new Set<number>();
    for (const statement of factStatements ?? []) {
      if (!statement.trim()) continue;
      const index = text.indexOf(statement);
      if (index >= 0) positions.add(index);
      if (positions.size >= 3) break;
    }
    positions.add(firstFocus ?? first);
    positions.add(lastFocus);
    for (const index of occurrences.length <= capacity ? occurrences : regions.values()) {
      if (positions.size >= capacity) break;
      positions.add(index);
    }
    const sorted = [...positions].sort((a, b) => a - b);
    // Nearby matches share a passage. Allocate the source's budget across
    // distinct locations, retaining the original bytes even at the boundaries.
    const width = Math.floor(budget / sorted.length);
    const windows: { start: number; end: number }[] = [];
    for (const index of sorted) {
      const start = Math.max(
        0,
        Math.min(index - Math.floor(width / (pair ? 2 : 3)), text.length - width),
      );
      const previous = windows.at(-1);
      if (previous && start <= previous.end) previous.end = start + width;
      else windows.push({ start, end: start + width });
    }
    return windows.map(({ start, end }) => ({ rawEventId, text: text.slice(start, end) }));
  });
}
