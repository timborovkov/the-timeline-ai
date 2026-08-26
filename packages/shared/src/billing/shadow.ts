import { getEnv } from '#src/env.js';

/**
 * Live charging is the process-wide `BILLING_CHARGES_ENABLED` toggle.
 * Webhook rows snapshot that flag, so flipping the env to true must take
 * effect immediately even when existing paid accounts still have
 * `shadowBilling = true`.
 */
export function accountUsesShadowBilling(account: { shadowBilling: boolean }): boolean {
  if (getEnv().BILLING_CHARGES_ENABLED) return false;
  return account.shadowBilling;
}

export function shadowBillingFromChargesEnabled(chargesEnabled = getEnv().BILLING_CHARGES_ENABLED) {
  return !chargesEnabled;
}
