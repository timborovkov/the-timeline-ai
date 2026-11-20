import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

import { expect, vi } from '@timeline/test-support';
import { it } from 'bun:test';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// The archive must match the content actually published for acceptance.
await vi.mock(
  import.meta.resolve('@/components/public-shell'),
  () => ({ PublicShell: ({ children }: { children: ReactNode }) => children }),
  () => import('@/components/public-shell'),
);

const { default: TermsPage } = await import('@/app/terms/page');
const { default: PrivacyPage } = await import('@/app/privacy/page');
const { TERMS_VERSION, PRIVACY_VERSION } = await import('@/lib/legal-versions');
const archive = new URL('./legal-archive/', import.meta.url);
const hashesFile = Bun.file(new URL('hashes.json', archive));

it('matches each published legal document to its versioned archive and digest', async () => {
  const hashes = (await hashesFile.json()) as Record<'terms' | 'privacy', Record<string, string>>;
  for (const { name, version, page } of [
    { name: 'terms', version: TERMS_VERSION, page: <TermsPage /> },
    { name: 'privacy', version: PRIVACY_VERSION, page: <PrivacyPage /> },
  ] as const) {
    const rendered = renderToStaticMarkup(page);
    expect(rendered).toContain(`Version ${version}`);
    const content = rendered
      .replace(/ class="[^"]*"/g, '')
      .replace(/><(?=\/?(?:main|p|h1|h2|li|ul|ol|article|table|thead|tbody|tr)\b)/g, '>\n<');
    const document = `${content}\n`;
    const digest = createHash('sha256').update(document).digest('hex');
    const path = new URL(`${name}-${version}.txt`, archive);
    if (process.env.CREATE_LEGAL_ARCHIVE === '1' && !hashes[name][version]) {
      await writeFile(path, document, { flag: 'wx' });
      hashes[name][version] = digest;
      await Bun.write(hashesFile, `${JSON.stringify(hashes, null, 2)}\n`);
    }
    expect(await Bun.file(path).text()).toBe(document);
    expect(hashes[name][version]).toBe(digest);
  }
});
