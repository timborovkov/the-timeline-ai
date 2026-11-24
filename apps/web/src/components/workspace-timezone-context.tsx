'use client';

import { createContext, use, useMemo, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';

import { resolveRegionalFormat, type RegionalFormat } from '@/lib/regional-format';
import { DEFAULT_TIMEZONE } from '@/lib/timezones';

const WorkspaceTimezoneContext = createContext(DEFAULT_TIMEZONE);

const DEFAULT_REGION = resolveRegionalFormat();
const RegionalFormatContext = createContext({
  initial: DEFAULT_REGION,
  interactive: DEFAULT_REGION,
});
const EMPTY_REGIONAL_CHOICES: Partial<RegionalFormat> = {};
const RegionalChoicesContext = createContext(EMPTY_REGIONAL_CHOICES);

function subscribe() {
  return () => undefined;
}

function subscribeLanguage(onChange: () => void) {
  window.addEventListener('languagechange', onChange);
  return () => {
    window.removeEventListener('languagechange', onChange);
  };
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
  const display = useMemo(() => {
    const initial = resolveRegionalFormat(region, { locale: region?.browserLocale }, timezone);
    if (!region || (!browserLocale && !browserTimezone)) return { initial, interactive: initial };
    const interactive = resolveRegionalFormat(
      region,
      { locale: browserLocale ?? region.browserLocale, timezone: browserTimezone },
      timezone,
    );
    return {
      initial,
      interactive:
        interactive.locale === initial.locale && interactive.timezone === initial.timezone
          ? initial
          : interactive,
    };
  }, [region, browserLocale, browserTimezone, timezone]);
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
  const { initial, interactive } = use(RegionalFormatContext);
  // Streamed children may hydrate after the provider has read the browser region.
  return useSyncExternalStore(
    subscribe,
    () => interactive,
    () => initial,
  );
}

export function useRegionalChoices(): Partial<RegionalFormat> {
  return use(RegionalChoicesContext);
}
