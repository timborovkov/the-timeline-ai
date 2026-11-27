'use client';

import { useRegionalFormat } from '@/components/workspace-timezone-context';

export function RegionalTimezone() {
  return useRegionalFormat().timezone;
}
