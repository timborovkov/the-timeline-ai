import { getEnv } from '#src/env.js';

/**
 * Live charging is the process-wide `BILLING_CHARGES_ENABLED` toggle in both
 * directions. `true` charges immediately even when a row still snapshots
 * `shadowBilling = true`. `false` is a kill switch: every reservation and
 * settlement is shadow, even if a row already recorded live charging.
 */
export function accountUsesShadowBilling(_account?: { shadowBilling: boolean }): boolean {
  return !getEnv().BILLING_CHARGES_ENABLED;
}

export function shadowBillingFromChargesEnabled(chargesEnabled = getEnv().BILLING_CHARGES_ENABLED) {
  return !chargesEnabled;
}
