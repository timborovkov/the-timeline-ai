import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const harnessDir = path.dirname(fileURLToPath(import.meta.url));

function matchesBunPin(pin: string, version: string, revision: string): boolean {
  const result = spawnSync(
    'python3',
    [
      '-c',
      [
        'import json, sys',
        'from bun_pin import matches_bun_pin',
        'pin, version, revision = json.load(sys.stdin)',
        'print("true" if matches_bun_pin(pin, version=version, revision=revision) else "false")',
      ].join('; '),
    ],
    {
      cwd: harnessDir,
      input: JSON.stringify([pin, version, revision]),
      encoding: 'utf8',
    },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim() === 'true';
}

assert.equal(
  matchesBunPin('1.4.5', '1.4.5', '1.4.5+abcdef'),
  true,
  'numeric pins accept an exact process.versions.bun match',
);
assert.equal(
  matchesBunPin('1.4.5', '1.4.6', '1.4.6+abcdef'),
  false,
  'numeric pins reject a different process.versions.bun',
);
assert.equal(
  matchesBunPin('1.4.5', '1.4.5', '1.4.5-canary.1+abcdef'),
  true,
  'numeric pins still use exact version equality even when revision mentions canary',
);

assert.equal(
  matchesBunPin('canary', '1.4.6', '1.4.6-canary.1+7bb427f3b'),
  true,
  'canary pin accepts a canary revision',
);
assert.equal(
  matchesBunPin('canary', '1.4.6', '1.4.6+7bb427f3b'),
  false,
  'canary pin rejects a stable revision with the same version number',
);
assert.equal(
  matchesBunPin(' canary\n', '1.4.6', '1.4.6-canary.1+7bb427f3b'),
  true,
  'canary pin trims surrounding whitespace from .bun-version',
);

assert.equal(matchesBunPin('', '1.4.6', '1.4.6-canary.1+7bb427f3b'), false);
assert.equal(matchesBunPin('   ', '1.4.6', '1.4.6-canary.1+7bb427f3b'), false);

console.log('bun pin matching cases passed');
