import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

/**
 * BillingAdmissionError only delays a worker when it leaves the job. This scan
 * fails when a catch around an AI call, a withWorkerAiBilling / withAiMetering
 * caller, or an LLM helper returns a degraded result. A conditional `throw err`
 * is not propagation when another path returns.
 */
const AI_CALL =
  /\b(?:chatStructured|chat|generateAndStore[A-Za-z]*|embedMany|embedTextBatch|transcribeAudio|extractTextFromMedia|planReconciliation|classifyTaskCategor[A-Za-z]*|askAgent|streamChat|withAiMetering|withWorkerAiBilling|generateStructuredObject|generateJsonObjectFallback)\s*\(|\bawait\s+structured\s*\(/;

const SCAN_ROOTS = ['apps/worker/src', 'apps/web/src', 'packages/shared/src'];

function maskSource(source: string): string {
  const chars = source.split('');
  maskCode(chars, 0, chars.length, false);
  return chars.join('');
}

function maskCode(
  chars: string[],
  start: number,
  end: number,
  stopOnUnmatchedBrace: boolean,
): number {
  let index = start;
  let depth = 0;
  while (index < end) {
    const current = chars[index] ?? '';
    const next = chars[index + 1] ?? '';
    if (current === '/' && next === '/') {
      index += 2;
      while (index < end && chars[index] !== '\n') {
        chars[index] = ' ';
        index += 1;
      }
      continue;
    }
    if (current === '/' && next === '*') {
      chars[index] = ' ';
      chars[index + 1] = ' ';
      index += 2;
      while (index < end && !(chars[index] === '*' && chars[index + 1] === '/')) {
        if (chars[index] !== '\n') chars[index] = ' ';
        index += 1;
      }
      if (index < end) {
        chars[index] = ' ';
        if (chars[index + 1] !== undefined) chars[index + 1] = ' ';
        index += 2;
      }
      continue;
    }
    if (current === "'" || current === '"') {
      index = maskQuoted(chars, index, end, current);
      continue;
    }
    if (current === '`') {
      index = maskTemplate(chars, index + 1, end);
      continue;
    }
    if (current === '{') depth += 1;
    if (current === '}') {
      if (depth === 0) {
        if (stopOnUnmatchedBrace) return index;
      } else depth -= 1;
    }
    index += 1;
  }
  return index;
}

function maskQuoted(chars: string[], start: number, end: number, quote: string): number {
  let index = start + 1;
  while (index < end) {
    if (chars[index] === '\\') {
      chars[index] = ' ';
      if (chars[index + 1] !== undefined && chars[index + 1] !== '\n') chars[index + 1] = ' ';
      index += 2;
      continue;
    }
    if (chars[index] === quote) return index + 1;
    if (chars[index] !== '\n') chars[index] = ' ';
    index += 1;
  }
  return index;
}

function maskTemplate(chars: string[], start: number, end: number): number {
  let index = start;
  while (index < end) {
    if (chars[index] === '\\') {
      chars[index] = ' ';
      if (chars[index + 1] !== undefined && chars[index + 1] !== '\n') chars[index + 1] = ' ';
      index += 2;
      continue;
    }
    if (chars[index] === '`') return index + 1;
    if (chars[index] === '$' && chars[index + 1] === '{') {
      chars[index] = ' ';
      chars[index + 1] = ' ';
      index = maskCode(chars, index + 2, end, true);
      if (chars[index] === '}') index += 1;
      continue;
    }
    if (chars[index] !== '\n') chars[index] = ' ';
    index += 1;
  }
  return index;
}

function skipWhitespace(source: string, index: number): number {
  let cursor = index;
  while (cursor < source.length && /\s/.test(source[cursor] ?? '')) cursor += 1;
  return cursor;
}

function keywordAt(source: string, index: number, word: string): boolean {
  if (!source.startsWith(word, index)) return false;
  const before = index === 0 ? '' : (source[index - 1] ?? '');
  const after = source[index + word.length] ?? '';
  return !/[\w$]/.test(before) && !/[\w$]/.test(after);
}

function matchingBrace(source: string, openIndex: number): number {
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function matchingParenBackward(source: string, closeIndex: number): number {
  let depth = 0;
  for (let index = closeIndex; index >= 0; index -= 1) {
    if (source[index] === ')') depth += 1;
    else if (source[index] === '(') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function containsAiCall(source: string): boolean {
  return AI_CALL.test(source);
}

function propagatesAdmission(catchBody: string, binding: string | null): boolean {
  if (catchBody.includes('isBillingAdmissionError(')) return true;
  if (catchBody.includes('rethrowBillingAdmission(')) return true;
  if (!binding) return false;
  // `if (isRetryable(err)) throw err; return degraded` still completes the job.
  if (/\breturn\b/.test(catchBody)) return false;
  return new RegExp(String.raw`\bthrow\s+${binding}\b`).test(catchBody);
}

function lineNumber(source: string, index: number): number {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (source.charCodeAt(cursor) === 10) line += 1;
  }
  return line;
}

function catchBinding(source: string, openParen: number, closeParen: number): string | null {
  const inside = source.slice(openParen + 1, closeParen);
  const match = /^\s*([A-Za-z_$][\w$]*)/.exec(inside);
  return match?.[1] ?? null;
}

interface CatchSite {
  binding: string | null;
  body: string;
  at: number;
}

function readCatch(source: string, catchIndex: number): { site: CatchSite; end: number } | null {
  let cursor = skipWhitespace(source, catchIndex + 'catch'.length);
  let binding: string | null = null;
  if (source[cursor] === '(') {
    const closeParen = source.indexOf(')', cursor);
    if (closeParen < 0) return null;
    binding = catchBinding(source, cursor, closeParen);
    cursor = skipWhitespace(source, closeParen + 1);
  }
  if (source[cursor] !== '{') return null;
  const closeBrace = matchingBrace(source, cursor);
  if (closeBrace < 0) return null;
  return {
    site: { binding, body: source.slice(cursor + 1, closeBrace), at: catchIndex },
    end: closeBrace + 1,
  };
}

function tryCatchSites(source: string): CatchSite[] {
  const sites: CatchSite[] = [];
  for (let index = 0; index < source.length; index += 1) {
    if (!keywordAt(source, index, 'try')) continue;
    const open = skipWhitespace(source, index + 3);
    if (source[open] !== '{') continue;
    const close = matchingBrace(source, open);
    if (close < 0) continue;
    const tryBody = source.slice(open + 1, close);
    const after = skipWhitespace(source, close + 1);
    if (!keywordAt(source, after, 'catch')) continue;
    const parsed = readCatch(source, after);
    if (!parsed) continue;
    if (containsAiCall(tryBody) && !propagatesAdmission(parsed.site.body, parsed.site.binding)) {
      sites.push(parsed.site);
    }
  }
  return sites;
}

function promiseCatchSites(source: string): CatchSite[] {
  const sites: CatchSite[] = [];
  for (let index = 0; index < source.length; index += 1) {
    if (!source.startsWith('.catch', index)) continue;
    const afterWord = source[index + '.catch'.length] ?? '';
    if (/[\w$]/.test(afterWord)) continue;
    const openParen = skipWhitespace(source, index + '.catch'.length);
    if (source[openParen] !== '(') continue;
    const handlerStart = skipWhitespace(source, openParen + 1);
    const parsed = readInlineHandler(source, handlerStart);
    if (!parsed) continue;
    if (
      promiseCatchGuardsAi(source, index) &&
      !propagatesAdmission(parsed.site.body, parsed.site.binding)
    ) {
      sites.push({ ...parsed.site, at: index });
    }
  }
  return sites;
}

function readInlineHandler(source: string, start: number): { site: CatchSite; end: number } | null {
  let cursor = start;
  if (source.startsWith('async', cursor) && /\s/.test(source[cursor + 5] ?? '')) {
    cursor = skipWhitespace(source, cursor + 5);
  }
  if (source.startsWith('function', cursor) && !/[\w$]/.test(source[cursor + 8] ?? 'x')) {
    cursor = skipWhitespace(source, cursor + 8);
  }
  if (source[cursor] !== '(') return null;
  const closeParen = source.indexOf(')', cursor);
  if (closeParen < 0) return null;
  const binding = catchBinding(source, cursor, closeParen);
  cursor = skipWhitespace(source, closeParen + 1);
  if (source.startsWith('=>', cursor)) cursor = skipWhitespace(source, cursor + 2);
  if (source[cursor] !== '{') return null;
  const closeBrace = matchingBrace(source, cursor);
  if (closeBrace < 0) return null;
  return {
    site: { binding, body: source.slice(cursor + 1, closeBrace), at: start },
    end: closeBrace,
  };
}

function promiseCatchGuardsAi(source: string, dotIndex: number): boolean {
  let cursor = dotIndex - 1;
  while (cursor >= 0 && /\s/.test(source[cursor] ?? '')) cursor -= 1;
  if (source[cursor] !== ')') return false;
  const open = matchingParenBackward(source, cursor);
  if (open < 0) return false;
  let nameEnd = open;
  while (nameEnd > 0 && /\s/.test(source[nameEnd - 1] ?? '')) nameEnd -= 1;
  let nameStart = nameEnd;
  while (nameStart > 0 && /[\w$]/.test(source[nameStart - 1] ?? '')) nameStart -= 1;
  const callee = source.slice(nameStart, nameEnd);
  const args = source.slice(open, cursor + 1);
  return containsAiCall(`${callee}(${args})`);
}

function aiCatchFindings(source: string, file = 'fixture.ts'): string[] {
  const masked = maskSource(source);
  return [...tryCatchSites(masked), ...promiseCatchSites(masked)].map(
    (site) =>
      `${file}:${String(lineNumber(source, site.at))} catch does not rethrow BillingAdmissionError`,
  );
}

function listTypeScriptSources(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      files.push(...listTypeScriptSources(path));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) continue;
    if (/\.(?:test|spec)\.tsx?$/.test(entry.name)) continue;
    files.push(path);
  }
  return files;
}

function scanProductionAiCatches(): string[] {
  const root = fileURLToPath(new URL('../../../..', import.meta.url));
  const findings: string[] = [];
  for (const scanRoot of SCAN_ROOTS) {
    for (const file of listTypeScriptSources(join(root, scanRoot))) {
      const source = readFileSync(file, 'utf8');
      findings.push(...aiCatchFindings(source, relative(root, file)));
    }
  }
  return findings;
}

describe('billing admission propagation', () => {
  it('flags an AI catch that stores an ordinary failure', () => {
    const source = [
      'try {',
      '  await chatStructured(input);',
      '} catch (err) {',
      "  return { status: 'failed', retryable: false };",
      '}',
    ].join('\n');
    expect(aiCatchFindings(source)).toEqual([
      'fixture.ts:3 catch does not rethrow BillingAdmissionError',
    ]);
  });

  it('accepts a catch that rethrows billing admission before recording failure', () => {
    const source = `
      try {
        await generateAndStoreObjectSummary();
      } catch (err) {
        if (isBillingAdmissionError(err)) throw err;
        return { status: 'failed' };
      }
      try {
        await structured({ schema });
      } catch (err) {
        rethrowBillingAdmission(err);
        return { status: 'failed' };
      }
    `;
    expect(aiCatchFindings(source)).toEqual([]);
  });

  it('accepts a promise catch that rethrows the admission error', () => {
    const source = `
      await generateJsonObjectFallback(input).catch((fallbackErr: unknown) => {
        if (isBillingAdmissionError(fallbackErr)) throw fallbackErr;
        throw new AggregateError([fallbackErr], 'fallback failed');
      });
    `;
    expect(aiCatchFindings(source)).toEqual([]);
  });

  it('flags a fallback that returns a degraded result after rethrowing only some errors', () => {
    const source = [
      'try {',
      '  await chat({ schema });',
      '} catch (err) {',
      '  if (isRetryableSummaryError(err)) throw err;',
      '  return { summary: null };',
      '}',
    ].join('\n');
    expect(aiCatchFindings(source)).toEqual([
      'fixture.ts:3 catch does not rethrow BillingAdmissionError',
    ]);
  });

  it('flags a metering wrapper whose catch returns a degraded result', () => {
    const source = [
      'try {',
      '  await withWorkerAiBilling(db, teamId, "meeting_finalize", work);',
      '} catch (err) {',
      '  return { completed: true, summary: null };',
      '}',
      'try {',
      '  await withAiMetering({ operationClass: "embedding" }, embed);',
      '} catch (err) {',
      '  if (shouldSplit(err)) return { vectors: [] };',
      '  throw err;',
      '}',
    ].join('\n');
    expect(aiCatchFindings(source)).toEqual([
      'fixture.ts:3 catch does not rethrow BillingAdmissionError',
      'fixture.ts:8 catch does not rethrow BillingAdmissionError',
    ]);
  });

  it('accepts a degraded summary fallback that rethrows billing admission first', () => {
    const source = [
      'try {',
      '  await chat({ schema });',
      '} catch (err) {',
      '  if (isBillingAdmissionError(err)) throw err;',
      '  if (isRetryableSummaryError(err)) throw err;',
      '  return { summary: null };',
      '}',
      'try {',
      '  await withWorkerAiBilling(db, teamId, "task_category", work);',
      '} catch (error) {',
      '  throw error;',
      '}',
    ].join('\n');
    expect(aiCatchFindings(source)).toEqual([]);
  });

  it('ignores catches that do not wrap an AI call', () => {
    const source = `
      try {
        await enqueueSuggestionJob();
      } catch (err) {
        log.error(err);
      }
    `;
    expect(aiCatchFindings(source)).toEqual([]);
  });

  it('keeps production AI catches from swallowing billing admission', () => {
    expect(scanProductionAiCatches()).toEqual([]);
  });
});
