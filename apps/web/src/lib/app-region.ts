import { createHash } from 'node:crypto';

import { cookies, headers } from 'next/headers';
import { cache } from 'react';

import { getRequestIdentity } from '@/lib/auth';
import { validDisplayLocale, validDisplayTimezone } from '@/lib/regional-format';

export function displayRegionCookieNames(userId: string) {
  const suffix = createHash('sha256').update(userId).digest('hex').slice(0, 24);
  return {
    locale: `timeline-display-locale-${suffix}`,
    timezone: `timeline-display-timezone-${suffix}`,
  };
}

export const readAppRegion = cache(async () => {
  const [cookieStore, requestHeaders, { session }] = await Promise.all([
    cookies(),
    headers(),
    getRequestIdentity(),
  ]);
  const names = session?.user.id ? displayRegionCookieNames(session.user.id) : undefined;
  const browserLocale = requestHeaders
    .get('accept-language')
    ?.slice(0, 1024)
    .split(',')
    .map((entry) => {
      const [tag, weight] = entry.trim().split(';');
      return {
        locale: validDisplayLocale(tag),
        weight: weight ? Number(weight.trim().slice(2)) : 1,
      };
    })
    .sort((a, b) => b.weight - a.weight)
    .find(({ locale, weight }) => locale && weight > 0)?.locale;

  return {
    locale: validDisplayLocale(names ? cookieStore.get(names.locale)?.value : undefined),
    timezone: validDisplayTimezone(names ? cookieStore.get(names.timezone)?.value : undefined),
    browserLocale,
  };
});
