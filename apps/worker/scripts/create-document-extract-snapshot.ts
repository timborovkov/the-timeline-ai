/**
 * Build (or rebuild) the Daytona snapshot used by document-extract sandboxes.
 *
 * Usage:
 *   set -a; . ./.env; set +a
 *   pnpm --filter @timeline/worker create-document-extract-snapshot
 *
 * Env:
 *   DAYTONA_API_KEY (required)
 *   DAYTONA_API_URL (default https://app.daytona.io/api)
 *   DAYTONA_TARGET (default us)
 *   DAYTONA_SNAPSHOT (default timeline-document-extract)
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Daytona, Image } from '@daytonaio/sdk';

const HERE = dirname(fileURLToPath(import.meta.url));
const SANDBOX_DIR = join(HERE, '..', 'document-extract-sandbox');

async function main(): Promise<void> {
  const apiKey = process.env.DAYTONA_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('DAYTONA_API_KEY is required');
  }
  const apiUrl = process.env.DAYTONA_API_URL?.trim() || 'https://app.daytona.io/api';
  const target = process.env.DAYTONA_TARGET?.trim() || 'us';
  const name = process.env.DAYTONA_SNAPSHOT?.trim() || 'timeline-document-extract';

  const daytona = new Daytona({
    apiKey,
    apiUrl,
    target,
  });

  const image = Image.debianSlim('3.12')
    .pipInstallFromRequirements(join(SANDBOX_DIR, 'requirements.txt'))
    .workdir('/opt/timeline')
    .addLocalFile(join(SANDBOX_DIR, 'extract_pdf.py'), '/opt/timeline/extract_pdf.py')
    .addLocalFile(join(SANDBOX_DIR, 'extract_docx.py'), '/opt/timeline/extract_docx.py')
    .runCommands('chmod +x /opt/timeline/extract_pdf.py /opt/timeline/extract_docx.py');

  try {
    const existing = await daytona.snapshot.get(name);
    console.log(`Deleting existing snapshot "${name}"…`);
    await daytona.snapshot.delete(existing);
    // Daytona delete is eventually consistent on the name.
    for (let i = 0; i < 30; i++) {
      try {
        await daytona.snapshot.get(name);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch {
        break;
      }
    }
  } catch {
    // Snapshot does not exist yet — create below.
  }

  console.log(`Creating Daytona snapshot "${name}" (target=${target})…`);
  const snapshot = await daytona.snapshot.create(
    {
      name,
      image,
      resources: { cpu: 1, memory: 2, disk: 3 },
    },
    {
      onLogs: (chunk: string) => {
        process.stdout.write(chunk);
      },
    },
  );
  console.log(`\nSnapshot ready: ${snapshot.name ?? name}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
