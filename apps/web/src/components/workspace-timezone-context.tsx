'use client';

import { createContext, use, useMemo, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';

import { resolveRegionalFormat, type RegionalFormat } from '@/lib/regional-format';
import { DEFAULT_TIMEZONE } from '@/lib/timezones';

const WorkspaceTimezoneContext = createContext(DEFAULT_TIMEZONE);

const RegionalFormatContext = createContext(resolveRegionalFormat());
const EMPTY_REGIONAL_CHOICES: Partial<RegionalFormat> = {};
const RegionalChoicesContext = createContext(EMPTY_REGIONAL_CHOICES);

function subscribe() {
  return () => undefined;
}

function subscribeLanguage(onChange: () => void) {
  window.addEventListener('languagechange', onChange);
  return () => window.removeEventListener('languagechange', onChange);
}

function readBrowserLocale() {
  return navigator.language;
}

function readBrowserTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function readUnavailablePreference(): string | undefined {
  return undefined;
}

export function WorkspaceTimezoneProvider({
  children,
  timezone,
  region,
}: {
  children: ReactNode;
  timezone: string;
  region?: Partial<RegionalFormat> & { browserLocale?: string };
}) {
  const browserTimezone = useSyncExternalStore(
    subscribe,
    readBrowserTimezone,
    readUnavailablePreference,
  );
  const browserLocale = useSyncExternalStore(
    subscribeLanguage,
    readBrowserLocale,
    readUnavailablePreference,
  );
  const display = useMemo(
    () =>
      resolveRegionalFormat(
        region,
        {
          locale: region ? browserLocale || region.browserLocale : undefined,
          timezone: region ? browserTimezone : undefined,
        },
        timezone,
      ),
    [region, browserLocale, browserTimezone, timezone],
  );
  return (
    <WorkspaceTimezoneContext.Provider value={timezone}>
      <RegionalChoicesContext.Provider value={region ?? EMPTY_REGIONAL_CHOICES}>
        <RegionalFormatContext.Provider value={display}>{children}</RegionalFormatContext.Provider>
      </RegionalChoicesContext.Provider>
    </WorkspaceTimezoneContext.Provider>
  );
}

export function useWorkspaceTimezone(): string {
  return use(WorkspaceTimezoneContext);
}

export function useRegionalFormat(): RegionalFormat {
  return use(RegionalFormatContext);
}

export function useRegionalChoices(): Partial<RegionalFormat> {
  return use(RegionalChoicesContext);
}
