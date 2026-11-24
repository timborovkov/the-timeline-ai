'use server';

import { cookies } from 'next/headers';

import { displayRegionCookieNames } from '@/lib/app-region';
import { getRequestIdentity } from '@/lib/auth';
import { validDisplayLocale, validDisplayTimezone } from '@/lib/regional-format';

export async function saveDisplayRegion(
  _previous: { error?: string; saved?: boolean },
  data: FormData,
): Promise<{ error?: string; saved?: boolean }> {
  const { session, impersonation } = await getRequestIdentity();
  if (!session?.user || impersonation) return { error: 'Display preferences are unavailable.' };

  const localeInput = data.get('locale');
  const timezoneInput = data.get('timezone');
  if (typeof localeInput !== 'string' || typeof timezoneInput !== 'string') {
    return { error: 'Enter a valid locale and time zone.' };
  }
  const locale = validDisplayLocale(localeInput.trim());
  const timezone = validDisplayTimezone(timezoneInput.trim());
  if ((localeInput.trim() && !locale) || (timezoneInput.trim() && !timezone)) {
    return { error: 'Enter a supported locale and time zone.' };
  }

  const cookieStore = await cookies();
  const names = displayRegionCookieNames(session.user.id);
  const options = {
    path: '/app',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  } as const;
  for (const [name, value] of [
    [names.locale, locale],
    [names.timezone, timezone],
  ] as const) {
    cookieStore.set(name, value ?? '', { ...options, maxAge: value ? 60 * 60 * 24 * 365 : 0 });
  }
  return { saved: true };
}
