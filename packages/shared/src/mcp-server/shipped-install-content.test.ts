import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import { COMPAT_MCP_TOOL_NAMES } from '#src/mcp-server/handler.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

const SHIPPED_PATHS = [
  'plugins/timeline',
  '.agents/plugins',
  '.claude-plugin',
  'apps/web/src/lib/help-content.ts',
  'apps/web/src/lib/agent-install-content.ts',
] as const;

async function collectShippedFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectShippedFiles(path)));
      continue;
    }
    files.push(path);
  }
  return files;
}

describe('shipped Timeline MCP install content', () => {
  it('does not teach previous hosted MCP tool names', async () => {
    const files = (
      await Promise.all(
        SHIPPED_PATHS.map(async (relative) => {
          const path = join(repoRoot, relative);
          const statEntries = await readdir(path, { withFileTypes: true }).catch(() => null);
          if (!statEntries) return [path];
          return collectShippedFiles(path);
        }),
      )
    ).flat();

    expect(files.length).toBeGreaterThan(3);
    const hits: string[] = [];
    for (const file of files) {
      const contents = await readFile(file, 'utf8');
      for (const name of COMPAT_MCP_TOOL_NAMES) {
        if (contents.includes(name)) hits.push(`${file}:${name}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
