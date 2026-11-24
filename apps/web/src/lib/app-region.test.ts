import { expect, mock, test } from 'bun:test';

const saved = new Map<string, { value: string; maxAge: number }>();
let userId: string | undefined = 'synthetic-viewer-a';
let impersonation = false;
await mock.module('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      set(name: string, value: string, options: { maxAge: number }) {
        if (options.maxAge) saved.set(name, { value, maxAge: options.maxAge });
        else saved.delete(name);
      },
      get(name: string) {
        return saved.get(name);
      },
    }),
  headers: () =>
    Promise.resolve(new Headers({ 'accept-language': 'fr-FR;q=0.2,de-DE;q=0.8,en-US;q=0.7' })),
}));
await mock.module('@/lib/auth', () => ({
  getRequestIdentity: () =>
    Promise.resolve({
      session: userId ? { user: { id: userId } } : null,
      impersonation,
    }),
}));
const { saveDisplayRegion } = await import('@/app/app/team/display-region-action');
const { readAppRegion } = await import('@/lib/app-region');

function form(locale: string, timezone: string) {
  const data = new FormData();
  data.set('locale', locale);
  data.set('timezone', timezone);
  return data;
}

test('validates and saves account-specific preferences and clears them back to automatic', async () => {
  expect(await readAppRegion()).toEqual({
    browserLocale: 'de-DE',
    locale: undefined,
    timezone: undefined,
  });
  expect((await saveDisplayRegion({}, form('bad_locale', 'Asia/Tokyo'))).error).toBeDefined();
  expect(saved.size).toBe(0);
  expect(await saveDisplayRegion({}, form('en-US', 'Asia/Tokyo'))).toEqual({ saved: true });
  expect(await readAppRegion()).toEqual({
    browserLocale: 'de-DE',
    locale: 'en-US',
    timezone: 'Asia/Tokyo',
  });
  userId = 'synthetic-viewer-b';
  expect((await readAppRegion()).locale).toBeUndefined();
  userId = 'synthetic-viewer-a';
  impersonation = true;
  expect((await saveDisplayRegion({}, form('', ''))).error).toBeDefined();
  expect((await readAppRegion()).timezone).toBe('Asia/Tokyo');
  impersonation = false;
  expect(await saveDisplayRegion({}, form('', ''))).toEqual({ saved: true });
  expect(saved.size).toBe(0);
  userId = undefined;
  expect((await saveDisplayRegion({}, form('en-US', 'Asia/Tokyo'))).error).toBeDefined();
});
