import type { BillingReserveFailureCode } from '#src/billing/admission.js';

/** Cap / allowance denials that are expected product outcomes, not defects. */
export const EXPECTED_BILLING_ADMISSION_CODES = [
  'usage_limit_reached',
  'free_allowance_reached',
  'spend_cap_reached',
] as const satisfies readonly BillingReserveFailureCode[];

export type ExpectedBillingAdmissionCode = (typeof EXPECTED_BILLING_ADMISSION_CODES)[number];

const EXPECTED_BILLING_ADMISSION_CODE_SET = new Set<string>(EXPECTED_BILLING_ADMISSION_CODES);

const EXPECTED_BILLING_ADMISSION_FAILURE_RE =
  /Billing admission failed: (?:usage_limit_reached|free_allowance_reached|spend_cap_reached)\b/;

/** Fail-closed admission error for costly provider work. */
export class BillingAdmissionError extends Error {
  readonly code: BillingReserveFailureCode;

  constructor(code: BillingReserveFailureCode, message?: string) {
    super(message ?? `Billing admission failed: ${code}`);
    this.name = 'BillingAdmissionError';
    this.code = code;
  }
}

export function isBillingAdmissionError(err: unknown): err is BillingAdmissionError {
  return err instanceof BillingAdmissionError;
}

/**
 * True for allowance / spend / usage caps. Workers wrap these in
 * UnrecoverableError, so message matching stays part of the contract.
 * Unexpected codes such as `costly_worker_busy` and `security_blocked` stay
 * reportable.
 */
export function isExpectedBillingAdmissionFailure(err: unknown): boolean {
  if (isBillingAdmissionError(err)) {
    return EXPECTED_BILLING_ADMISSION_CODE_SET.has(err.code);
  }
  const message = err instanceof Error ? err.message : String(err);
  return EXPECTED_BILLING_ADMISSION_FAILURE_RE.test(message);
}

/**
 * Worker delay handling only runs when this error leaves the job. A catch
 * that records a normal failure instead leaves the slot busy and the work
 * unfinished.
 */
export function rethrowBillingAdmission(err: unknown): void {
  if (isBillingAdmissionError(err)) throw err;
}
