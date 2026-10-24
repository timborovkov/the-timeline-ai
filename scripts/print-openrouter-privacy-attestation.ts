import { loadEnvFile } from 'node:process';

import { buildOpenRouterPrivacyAttestationToken } from '@timeline/shared/llm/privacy-attestation';

function usage(): string {
  return [
    'Usage: pnpm openrouter:attestation [-- --env-file=/absolute/path/to/.env]',
    '',
    'Reads OPENROUTER_API_KEY and OPENROUTER_GUARDRAIL_ID, then prints only the',
    'non-secret OPENROUTER_PRIVACY_POLICY_ATTESTATION assignment.',
  ].join('\n');
}

function parseEnvFileArgument(args: readonly string[]): string | undefined {
  let envFile: string | undefined;
  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    }
    if (!arg.startsWith('--env-file=')) {
      throw new Error('Unknown argument. Use --help for usage.');
    }
    if (envFile !== undefined) {
      throw new Error('Only one --env-file argument is supported.');
    }
    envFile = arg.slice('--env-file='.length);
    if (!envFile) throw new Error('--env-file requires a path.');
  }
  return envFile;
}

function main(): void {
  const envFile = parseEnvFileArgument(process.argv.slice(2));
  if (envFile) loadEnvFile(envFile);

  const apiKey = process.env.OPENROUTER_API_KEY;
  const guardrailId = process.env.OPENROUTER_GUARDRAIL_ID;
  if (!apiKey || !guardrailId) {
    throw new Error(
      'OPENROUTER_API_KEY and OPENROUTER_GUARDRAIL_ID are required to generate the attestation.',
    );
  }

  const token = buildOpenRouterPrivacyAttestationToken({ apiKey, guardrailId });
  console.log(`OPENROUTER_PRIVACY_POLICY_ATTESTATION=${token}`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : 'Attestation generation failed.';
  console.error(message);
  process.exitCode = 1;
}
