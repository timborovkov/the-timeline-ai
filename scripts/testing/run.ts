import { readdirSync, readFileSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import manifest from './manifest.json';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const all = Object.keys(manifest);
const discovered = ['apps', 'packages', 'scripts'].flatMap((directory) =>
  readdirSync(resolve(root, directory), { recursive: true, withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry.name) &&
        !/(?:^|[/\\])(?:node_modules|dist)(?:[/\\]|$)/.test(entry.parentPath),
    )
    .map((entry) => relative(root, resolve(entry.parentPath, entry.name))),
);
const missing = discovered.filter((file) => !all.includes(file));
const stale = all.filter((file) => !discovered.includes(file));
if (missing.length || stale.length)
  throw new Error(
    `Test manifest mismatch: unclassified=${missing.join(', ')}; missing=${stale.join(', ')}`,
  );
const args = process.argv.slice(2).filter((arg) => arg !== '--');
const live = args.includes('--live');
const selectors = args.filter((arg) => !arg.startsWith('--'));
if (live && !selectors.length) throw new Error('--live requires an explicit file selector');
const selected = all.filter(
  (file) =>
    (manifest[file as keyof typeof manifest].group !== 'live' || live) &&
    (!selectors.length || selectors.some((selector) => file.includes(selector))),
);
const unmatched = selectors.filter((selector) => !selected.some((file) => file.includes(selector)));
if (unmatched.length)
  throw new Error(`No eligible tests matched selectors: ${unmatched.join(', ')}`);
if (!selected.length) throw new Error('No tests matched');
if (args.includes('--list')) {
  console.log(selected.join('\n'));
  process.exit(0);
}
// Allowlist rather than copying credentials into offline tests. Each file gets a
// fresh process and cannot contaminate another file's mocks or DOM environment.
const env: Record<string, string> = {};
for (const key of ['PATH', 'HOME', 'TMPDIR', 'CI', 'LANG', 'TZ', 'SYSTEMROOT'])
  if (process.env[key]) env[key] = process.env[key]!;
Object.assign(env, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgres://test:test@127.0.0.1:5432/test',
  AUTH_SECRET: 'test-secret-at-least-sixteen-characters',
  S3_BUCKET_DOCUMENTS: 'test-documents',
});
let failed = 0;
for (const file of selected) {
  const entry = manifest[file as keyof typeof manifest];
  if (entry.group === 'script') {
    console.log(`[bun-tests] ${file}`);
    const result = spawnSync(
      process.execPath,
      ['--no-env-file', '--conditions=development', file],
      {
        cwd: root,
        env,
        stdio: 'inherit',
        timeout: 600_000,
      },
    );
    if (result.error) console.error(`[bun-tests] ${file}: ${result.error.message}`);
    if (result.error || result.status !== 0) failed++;
    continue;
  }
  const fileEnv = {
    ...env,
    ...(file.startsWith('apps/worker/') ? { OPENROUTER_API_KEY: 'test-key' } : {}),
  };
  const pkg = file.split('/').slice(0, 2).join('/');
  const command = [
    'test',
    '--no-env-file',
    '--conditions=development',
    '--jsx-runtime=automatic',
    '--timeout',
    live ? '240000' : '120000',
  ];
  if (pkg === 'apps/web')
    command.push(
      '--tsconfig-override',
      resolve(root, 'apps/web/tsconfig.test.json'),
      '--preload',
      resolve(root, 'scripts/testing/web.ts'),
    );
  if (entry.group === 'dom') command.push('--preload', resolve(root, 'scripts/testing/dom.ts'));
  // Bound memory for large migration-backed files and isolate module-cache tests
  // fully, including dependencies of their dynamically imported entrypoints.
  const source = readFileSync(resolve(root, file), 'utf8');
  const names = [...source.matchAll(/\bit\(\s*'((?:\\'|[^'])+)'/g)].map((match) =>
    match[1]!.replaceAll("\\'", "'"),
  );
  const directTestCount = [...source.matchAll(/\bit\(/g)].length;
  const isolate = source.includes('vi.resetModules()');
  const chunk = names.length > 60 || isolate;
  const patterns: (string | undefined)[] = [];
  if (chunk && names.length > 0 && names.length === directTestCount) {
    const uniqueNames = [...new Set(names)];
    const size = isolate ? 1 : 20;
    for (let index = 0; index < uniqueNames.length; index += size) {
      patterns.push(
        '(?:' +
          uniqueNames
            .slice(index, index + size)
            .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('|') +
          ')$',
      );
    }
    // Parameterized/computed names and test() aliases are not extracted above.
    // Run their complement too, so chunking never silently drops those cases.
    patterns.push(
      '^(?!.*(?:' +
        uniqueNames.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') +
        ')$)',
    );
  } else patterns.push(undefined);
  for (const pattern of patterns) {
    console.log(`[bun-tests] ${file}${pattern ? ' (chunk)' : ''}`);
    const result = spawnSync(
      process.execPath,
      [
        ...command,
        ...(pattern ? ['--test-name-pattern', pattern] : []),
        ...(pattern?.startsWith('^(?!') ? ['--pass-with-no-tests'] : []),
        './' + relative(pkg, file),
      ],
      {
        cwd: resolve(root, pkg),
        env: live ? { ...process.env, NODE_ENV: 'test' } : fileEnv,
        stdio: 'inherit',
        timeout: 600_000,
      },
    );
    if (result.error) {
      console.error(`[bun-tests] ${file}: ${result.error.message}`);
      failed++;
      continue;
    }
    if (result.status !== 0) failed++;
  }
}
console.log(`[bun-tests] ${selected.length} files; ${failed} failed processes`);
process.exit(failed ? 1 : 0);
