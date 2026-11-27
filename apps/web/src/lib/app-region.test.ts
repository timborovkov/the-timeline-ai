import { expect, mock, test } from 'bun:test';

const saved = new Map<string, { value: string; maxAge: number; path: string }>();
let requestPath = '/app';
let userId: string | undefined = 'synthetic-viewer-a';
let impersonation = false;
await mock.module('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      set(name: string, value: string, options: { maxAge: number; path: string }) {
        if (options.maxAge) saved.set(name, { value, ...options });
        else saved.delete(name);
      },
      get(name: string) {
        const cookie = saved.get(name);
        return cookie?.path === requestPath ? cookie : undefined;
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
  requestPath = '/guest';
  expect(await readAppRegion('guest')).toEqual({
    browserLocale: 'de-DE',
    locale: 'en-US',
    timezone: 'Asia/Tokyo',
  });
  expect((await readAppRegion()).locale).toBeUndefined();
  requestPath = '/';
  expect((await readAppRegion('guest')).locale).toBeUndefined();
  expect((await readAppRegion()).locale).toBeUndefined();
  requestPath = '/guest';
  userId = undefined;
  expect((await readAppRegion('guest')).locale).toBeUndefined();
  userId = 'synthetic-viewer-b';
  expect((await readAppRegion('guest')).locale).toBeUndefined();
  requestPath = '/app';
  expect((await readAppRegion()).locale).toBeUndefined();
  expect(await saveDisplayRegion({}, form('fr-FR', 'Europe/Paris'))).toEqual({ saved: true });
  userId = 'synthetic-viewer-a';
  impersonation = true;
  expect((await saveDisplayRegion({}, form('', ''))).error).toBeDefined();
  expect((await readAppRegion()).timezone).toBe('Asia/Tokyo');
  impersonation = false;
  expect(await saveDisplayRegion({}, form('', ''))).toEqual({ saved: true });
  expect(saved.size).toBe(4);
  expect((await readAppRegion()).locale).toBeUndefined();
  requestPath = '/guest';
  expect((await readAppRegion('guest')).timezone).toBeUndefined();
  userId = 'synthetic-viewer-b';
  expect((await readAppRegion('guest')).timezone).toBe('Europe/Paris');
  requestPath = '/app';
  expect((await readAppRegion()).locale).toBe('fr-FR');
  userId = undefined;
  expect((await saveDisplayRegion({}, form('en-US', 'Asia/Tokyo'))).error).toBeDefined();
});
