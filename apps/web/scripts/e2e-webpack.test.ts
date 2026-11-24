import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect } from '@timeline/test-support';
import { it } from 'bun:test';
import { base } from 'next/dist/build/webpack/config/blocks/base';
import type { ConfigurationContext } from 'next/dist/build/webpack/config/utils';
import { webpack } from 'next/dist/compiled/webpack/webpack';

import { e2eWebpackPlugins } from './e2e-webpack';

interface ProbeConfig {
  plugins?: unknown[];
  [key: string]: unknown;
}

interface ProbeCompiler {
  run(
    done: (error: Error | null, stats?: { hasErrors(): boolean; toString(): string }) => void,
  ): void;
  close(done: (error?: Error | null) => void): void;
}

const compile = webpack as (config: ProbeConfig) => ProbeCompiler;
// This base block reads only compiler identity and source-map fields, not the
// full CSS/loader context used by Next's other configuration blocks.
const configureBase = base as (
  context: Partial<ConfigurationContext>,
) => (config: ProbeConfig) => ProbeConfig;

it('omits only Next development source maps for E2E while retaining plugin execution', async () => {
  expect(() => e2eWebpackPlugins([], true, true)).toThrow('source-map plugin changed');
  const directory = mkdtempSync(join(tmpdir(), 'timeline-e2e-webpack-'));
  try {
    const entry = join(directory, 'entry.cjs');
    writeFileSync(entry, 'module.exports = { answer: 42 };');
    const require = createRequire(import.meta.url);
    for (const enabled of [false, true]) {
      let instrumentationRuns = 0;
      const sentinel = {
        apply() {
          instrumentationRuns++;
        },
      };
      const config = configureBase({
        isDevelopment: true,
        isProduction: false,
        isServer: true,
        isClient: false,
        isEdgeRuntime: false,
        targetWeb: false,
        productionBrowserSourceMaps: false,
        serverSourceMaps: false,
      })({
        entry,
        cache: false,
        plugins: [sentinel],
        output: {
          path: join(directory, enabled ? 'e2e' : 'ordinary'),
          filename: 'bundle.cjs',
          library: { type: 'commonjs2' },
        },
      });
      const original = config.plugins ?? [];
      expect(original).toHaveLength(2);
      expect(e2eWebpackPlugins(original, false, true)).toBe(original);
      expect(e2eWebpackPlugins(original, true, false)).toBe(original);
      config.plugins = e2eWebpackPlugins(original, true, enabled);
      expect(config.plugins).toContain(sentinel);
      expect(config.plugins).toHaveLength(enabled ? 1 : 2);
      const compiler = compile(config);
      await new Promise<void>((resolve, reject) => {
        compiler.run((error, stats) => {
          if (error) reject(error);
          else if (stats?.hasErrors()) reject(new Error(stats.toString()));
          else resolve();
        });
      });
      await new Promise<void>((resolve, reject) => {
        compiler.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      const output = join(directory, enabled ? 'e2e' : 'ordinary', 'bundle.cjs');
      expect(readFileSync(output, 'utf8').includes('sourceMappingURL=data:')).toBe(!enabled);
      expect(require(output)).toEqual({ answer: 42 });
      expect(instrumentationRuns).toBe(1);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
