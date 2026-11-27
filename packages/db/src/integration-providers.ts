export const NATIVE_PROVIDER_IDS = [
  'google_drive',
  'linear',
  'github',
  'monday',
  'slack',
  'sentry',
  'hubspot',
] as const;

export type NativeProviderId = (typeof NATIVE_PROVIDER_IDS)[number];

export function isNativeProviderId(provider: string): provider is NativeProviderId {
  return (NATIVE_PROVIDER_IDS as readonly string[]).includes(provider);
}

export const BOARD_IMPORT_PROVIDERS = [
  'github',
  'hubspot',
] as const satisfies readonly NativeProviderId[];
export type BoardImportProvider = (typeof BOARD_IMPORT_PROVIDERS)[number];

export function isBoardImportProvider(id: string): id is BoardImportProvider {
  return (BOARD_IMPORT_PROVIDERS as readonly string[]).includes(id);
}
