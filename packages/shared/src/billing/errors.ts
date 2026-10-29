import type { BillingReserveFailureCode } from '#src/billing/admission.js';

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
 * Worker delay handling only runs when this error leaves the job. A catch
 * that records a normal failure instead leaves the slot busy and the work
 * unfinished.
 */
export function rethrowBillingAdmission(err: unknown): void {
  if (isBillingAdmissionError(err)) throw err;
}
