import { assertE2eDiskCapacity, buildE2eEnv, buildE2eWebServerConfig } from './e2e-env.js';

assertE2eDiskCapacity();
const env = buildE2eEnv({ ...process.env, E2E_PRECOMPILED: '1' });
const { baseURL } = buildE2eWebServerConfig(env);
env.AUTH_URL = baseURL;
env.NEXTAUTH_URL = baseURL;

const build = Bun.spawn(
  [process.execPath, 'x', '--bun', '--no-install', 'next', 'build', 'apps/web', '--webpack'],
  { env, stdout: 'inherit', stderr: 'inherit' },
);
const buildStatus = await build.exited;
if (buildStatus !== 0) process.exit(buildStatus);

const playwright = Bun.spawn(
  [process.execPath, 'scripts/run-e2e-strict.ts', ...process.argv.slice(2)],
  { env, stdout: 'inherit', stderr: 'inherit' },
);
process.exit(await playwright.exited);
