import { isNativeProviderId, type NativeProviderId } from '@timeline/db/integration-providers';

export const NATIVE_PROVIDER_LABELS = {
  google_drive: 'Google Drive',
  linear: 'Linear',
  github: 'GitHub',
  monday: 'Monday.com',
  slack: 'Slack',
  sentry: 'Sentry',
  hubspot: 'HubSpot',
} as const satisfies Record<NativeProviderId, string>;

export function nativeProviderLabel(provider: string): string {
  return isNativeProviderId(provider) ? NATIVE_PROVIDER_LABELS[provider] : provider;
}
