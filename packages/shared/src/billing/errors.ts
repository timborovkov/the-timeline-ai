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
