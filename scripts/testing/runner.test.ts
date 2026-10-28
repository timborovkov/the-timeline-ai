import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
function list(...selectors: string[]) {
  return spawnSync(
    process.execPath,
    ['--no-env-file', 'scripts/testing/run.ts', ...selectors, '--list'],
    {
      cwd: root,
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
    },
  );
}
const valid = list('railway-config.test.ts');
assert.equal(valid.status, 0, valid.stderr);
assert.ok(valid.stdout.includes('apps/web/src/railway-config.test.ts'));
assert.ok(valid.stdout.includes('apps/worker/src/railway-config.test.ts'));
const mixed = list('railway-config.test.ts', 'definitely-missing.test.ts');
assert.notEqual(mixed.status, 0);
assert.match(mixed.stderr, /No eligible tests matched selectors: definitely-missing.test.ts/);
const liveWithoutOptIn = list('src/agent/live-eval.test.ts');
assert.notEqual(liveWithoutOptIn.status, 0);
const explicitLive = list('src/agent/live-eval.test.ts', '--live');
assert.equal(explicitLive.status, 0, explicitLive.stderr);
assert.ok(explicitLive.stdout.includes('src/agent/live-eval.test.ts'));
console.log('Test selector contracts passed');

const workflow = readFileSync(
  new URL('../../.github/workflows/publish-document-extract-snapshot.yml', import.meta.url),
  'utf8',
);
const nameCommand = workflow.match(/NAME="\$\(([^\n]+)\)"/)?.[1];
assert.ok(nameCommand, 'snapshot workflow must expose its name command');
const snapshot = spawnSync('bash', ['-c', nameCommand], {
  cwd: root,
  encoding: 'utf8',
  env: { PATH: process.env.PATH, HOME: process.env.HOME },
});
assert.equal(snapshot.status, 0, snapshot.stderr);
assert.match(snapshot.stdout.trim(), /^timeline-document-extract-[a-f0-9]+$/);
console.log('Snapshot workflow output contract passed');

const fixture = mkdtempSync(join(tmpdir(), 'bun-install-runtime-'));
try {
  mkdirSync(join(fixture, 'local-tool'));
  mkdirSync(join(fixture, 'host-bin'));
  writeFileSync(
    join(fixture, 'host-bin/node'),
    '#!/bin/sh\nprintf \'{"node":"external-node"}\' > runtime.json\n',
    { mode: 0o755 },
  );
  const rootPackage = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    scripts: { deps: string };
  };
  writeFileSync(
    join(fixture, 'package.json'),
    JSON.stringify({
      name: 'runtime-probe',
      private: true,
      scripts: { deps: rootPackage.scripts.deps },
      dependencies: { 'local-tool': 'file:./local-tool' },
      trustedDependencies: ['local-tool'],
    }),
  );
  writeFileSync(join(fixture, 'bunfig.toml'), readFileSync(join(root, 'bunfig.toml')));
  writeFileSync(
    join(fixture, 'local-tool/package.json'),
    JSON.stringify({
      name: 'local-tool',
      version: '1.0.0',
      scripts: {
        postinstall: `node -e "require('node:fs').writeFileSync('runtime.json',JSON.stringify(process.versions))"`,
      },
    }),
  );
  const installEnv = {
    PATH: [join(fixture, 'host-bin'), dirname(process.execPath), process.env.PATH].join(':'),
    HOME: process.env.HOME,
  };
  for (const flags of [[], ['--frozen-lockfile']]) {
    const installed = spawnSync(process.execPath, ['--no-env-file', 'run', 'deps', ...flags], {
      cwd: fixture,
      env: installEnv,
      encoding: 'utf8',
    });
    assert.equal(installed.status, 0, installed.stderr);
  }
  const runtime = JSON.parse(
    readFileSync(join(fixture, 'node_modules/local-tool/runtime.json'), 'utf8'),
  ) as { bun?: string };
  assert.equal(
    runtime.bun,
    process.versions.bun,
    'dependency lifecycle must use Bun, not host Node',
  );
  console.log('Frozen install and lifecycle runtime contracts passed');
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
