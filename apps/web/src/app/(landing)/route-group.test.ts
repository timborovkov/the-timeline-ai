import { existsSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const landingRouteFile = (name: string) => new URL(`./${name}`, import.meta.url);
const rootRouteFile = (name: string) => new URL(`../${name}`, import.meta.url);

describe('landing route group', () => {
  it('keeps the root URL route and its recovery boundaries inside a URL-neutral group', () => {
    expect(existsSync(landingRouteFile('page.tsx'))).toBe(true);
    expect(existsSync(landingRouteFile('loading.tsx'))).toBe(true);
    expect(existsSync(landingRouteFile('error.tsx'))).toBe(true);

    expect(existsSync(rootRouteFile('page.tsx'))).toBe(false);
    expect(existsSync(rootRouteFile('loading.tsx'))).toBe(false);
    expect(existsSync(rootRouteFile('error.tsx'))).toBe(false);
  });
});
