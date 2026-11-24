import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { expect } from '@timeline/test-support';
import { it } from 'bun:test';
import { webpack } from 'next/dist/compiled/webpack/webpack';

import { e2eServerSplitChunks } from './e2e-webpack';

interface ProbeCompiler {
  run(
    done: (error: Error | null, stats?: { hasErrors(): boolean; toString(): string }) => void,
  ): void;
  close(done: (error?: Error | null) => void): void;
}

const createCompiler = webpack as (config: Record<string, unknown>) => ProbeCompiler;

it('shares workspace modules between development server routes within the same layer', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'timeline-e2e-webpack-'));
  try {
    const shared = join(directory, 'packages/shared/src/fixture.cjs');
    mkdirSync(dirname(shared), { recursive: true });
    writeFileSync(shared, 'module.exports = "compiled workspace fixture";');
    const entry = Object.fromEntries(
      ['one', 'two', 'handler'].map((name) => {
        const source = join(directory, `${name}.cjs`);
        writeFileSync(source, 'module.exports = require("./packages/shared/src/fixture.cjs");');
        return [name, { import: source, layer: name === 'handler' ? 'api-node' : 'rsc' }];
      }),
    );
    const vendor = { test: /node_modules/, name: 'vendor' };
    expect(() => e2eServerSplitChunks(false, directory)).toThrow('chunk groups changed');
    const splitChunks = e2eServerSplitChunks(
      { cacheGroups: { vendor, default: false } },
      directory,
    );
    expect(splitChunks).toMatchObject({ cacheGroups: { vendor, default: false } });
    const output = join(directory, 'output');
    const compiler = createCompiler({
      mode: 'development',
      target: 'node',
      entry,
      cache: false,
      experiments: { layers: true },
      optimization: { splitChunks },
      output: { path: output, filename: '[name].cjs', library: { type: 'commonjs2' } },
    });
    try {
      await new Promise<void>((resolve, reject) => {
        compiler.run((error, stats) => {
          if (error) reject(error);
          else if (stats?.hasErrors()) reject(new Error(stats.toString()));
          else resolve();
        });
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        compiler.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
    const workspaceChunks = join(output, 'workspace-chunks');
    expect(readdirSync(workspaceChunks).sort()).toEqual(['api-node.cjs', 'rsc.cjs']);
    for (const name of ['api-node', 'rsc']) {
      expect(readFileSync(join(workspaceChunks, `${name}.cjs`), 'utf8')).toContain(
        'compiled workspace fixture',
      );
    }
    const require = createRequire(import.meta.url);
    for (const name of Object.keys(entry)) {
      const bundle = join(output, `${name}.cjs`);
      expect(readFileSync(bundle, 'utf8')).not.toContain('compiled workspace fixture');
      expect(require(bundle)).toBe('compiled workspace fixture');
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
