import { cpSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

const { nodeFileTrace } = createRequire(import.meta.url)('next/dist/compiled/@vercel/nft') as {
  nodeFileTrace: (
    entries: string[],
    options: { base: string; processCwd: string; conditions: string[] },
  ) => Promise<{ fileList: Set<string>; warnings: Set<Error> }>;
};

export async function copyBunSentryRuntime(workspaceRoot: string, standaloneRoot: string) {
  const appRoot = resolve(workspaceRoot, 'apps/web');
  const requireFromApp = createRequire(resolve(appRoot, 'package.json'));
  // Sentry intentionally stays external on Bun. Next's Node-oriented trace omits
  // its Bun export and dependencies, so supplement the artifact using that export.
  const entry = requireFromApp.resolve('@sentry/nextjs');
  const { fileList, warnings } = await nodeFileTrace([entry], {
    base: workspaceRoot,
    processCwd: appRoot,
    conditions: ['bun', 'node'],
  });
  if (warnings.size > 0) {
    throw new Error(`Bun Sentry runtime trace failed: ${[...warnings].map(String).join('\n')}`);
  }
  for (const file of fileList) {
    const source = resolve(workspaceRoot, file);
    const localPath = relative(workspaceRoot, source);
    if (isAbsolute(localPath) || localPath === '..' || localPath.startsWith('../')) {
      throw new Error('Bun Sentry runtime trace escaped the workspace');
    }
    const destination = resolve(standaloneRoot, localPath);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(source, destination, { dereference: true });
  }
}
