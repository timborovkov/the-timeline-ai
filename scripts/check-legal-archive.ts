import { spawnSync } from 'node:child_process';

const archive = 'apps/web/src/lib/legal-archive';
const base = process.argv[2];

if (!base || !/^[a-f0-9]{40}$/.test(base)) {
  throw new Error('Pass the full Git SHA of the PR base to check the legal archive');
}

function git(...args: string[]): string {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr.trim() || 'Git archive check failed');
  return result.stdout;
}

const currentHashes = (await Bun.file(`${archive}/hashes.json`).json()) as Record<
  string,
  Record<string, string>
>;
const files = git('ls-tree', '--name-only', base, `${archive}/`).trim().split('\n').filter(Boolean);
for (const file of files) {
  const previous = git('show', `${base}:${file}`);
  if (file === `${archive}/hashes.json`) {
    const previousHashes = JSON.parse(previous) as Record<string, Record<string, string>>;
    for (const [kind, versions] of Object.entries(previousHashes)) {
      for (const [version, hash] of Object.entries(versions)) {
        if (currentHashes[kind]?.[version] !== hash) {
          throw new Error(`Archived ${kind} ${version} digest changed`);
        }
      }
    }
  } else if ((await Bun.file(file).text()) !== previous) {
    throw new Error(`Archived legal text changed in ${file}`);
  }
}
