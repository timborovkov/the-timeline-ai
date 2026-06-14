import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const sourceRoot = path.join(process.cwd(), 'src');
const browserDialogPatterns = [
  /\bwindow\.(?:alert|confirm|prompt)\s*\(/,
  /(^|[^\w.])(?:alert|confirm|prompt)\s*\(/,
];

function sourceFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const absolute = path.join(dir, entry);
    const stat = statSync(absolute);
    if (stat.isDirectory()) {
      files.push(...sourceFiles(absolute));
      continue;
    }
    if (!/\.(?:ts|tsx)$/.test(entry)) continue;
    if (entry === 'no-browser-dialogs.test.ts') continue;
    files.push(absolute);
  }
  return files;
}

describe('browser dialog guard', () => {
  it('keeps app code on the in-app dialog primitives', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(sourceRoot)) {
      const relative = path.relative(process.cwd(), file);
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, index) => {
        if (browserDialogPatterns.some((pattern) => pattern.test(line))) {
          offenders.push(`${relative}:${String(index + 1)} ${line.trim()}`);
        }
      });
    }

    expect(offenders).toEqual([]);
  });
});
