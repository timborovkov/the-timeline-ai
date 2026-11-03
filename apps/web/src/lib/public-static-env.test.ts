import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

const webSrc = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const SKIP_APP_PREFIXES = ['app/app/', 'app/(platform)/', 'app/api/', 'app/dev/'];
const EXTRA_PUBLIC_MODULES = [
  'components/marketing',
  'components/help',
  'components/support-email-provider.tsx',
  'components/legal-page.tsx',
  'components/public-analytics.tsx',
];

const BAKED_RUNTIME_ENV =
  /\b(?:getSupportEmail|getLegalContactEmail|getEnv|isLegalPublicationReady)\s*\(|\bprocess\.env\b/;
const FORCE_DYNAMIC = /export const dynamic = ['"]force-dynamic['"]/;

function walkFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return walkFiles(path);
    return entry.name.endsWith('.tsx') || entry.name.endsWith('.ts') ? [path] : [];
  });
}

function collect(relativePath: string): string[] {
  const absolute = resolve(webSrc, relativePath);
  if (statSync(absolute).isDirectory()) {
    return walkFiles(absolute).map((path) => relative(webSrc, path).replaceAll('\\', '/'));
  }
  return [relativePath];
}

function publicPageAndLayoutPaths(): string[] {
  return walkFiles(resolve(webSrc, 'app'))
    .map((path) => relative(webSrc, path).replaceAll('\\', '/'))
    .filter((relativePath) => {
      if (SKIP_APP_PREFIXES.some((prefix) => relativePath.startsWith(prefix))) return false;
      return relativePath.endsWith('/page.tsx') || relativePath.endsWith('/layout.tsx');
    });
}

describe('static public pages do not bake request-time env', () => {
  it('keeps support email, legal publication, and getEnv off prerendered public modules', () => {
    const files = [
      ...new Set([...publicPageAndLayoutPaths(), ...EXTRA_PUBLIC_MODULES.flatMap(collect)]),
    ];
    const violations = files.flatMap((relativePath) => {
      if (relativePath.endsWith('.test.ts') || relativePath.endsWith('.test.tsx')) return [];
      const source = readFileSync(resolve(webSrc, relativePath), 'utf8');
      if (FORCE_DYNAMIC.test(source)) return [];
      return BAKED_RUNTIME_ENV.test(source) ? [relativePath] : [];
    });

    expect(violations).toEqual([]);
  });

  it('resolves Terms publication at request time', () => {
    const source = readFileSync(resolve(webSrc, 'app/terms/page.tsx'), 'utf8');
    expect(source).toContain("export const dynamic = 'force-dynamic'");
    expect(source).toContain('isLegalPublicationReady()');
  });
});
