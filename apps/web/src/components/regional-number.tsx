'use client';

import { useRegionalFormat } from '@/components/workspace-timezone-context';
import { formatDisplayCurrency, formatDisplayNumber } from '@/lib/regional-format';

export function RegionalNumber({
  value,
  currency,
  compactCurrency,
}: {
  value: number;
  currency?: 'USD' | 'EUR';
  compactCurrency?: boolean;
}) {
  const { locale } = useRegionalFormat();
  return currency
    ? formatDisplayCurrency(value, currency, locale, compactCurrency)
    : formatDisplayNumber(value, locale);
}
