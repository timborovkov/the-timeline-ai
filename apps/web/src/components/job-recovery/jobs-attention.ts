/** Keep in sync with `JOB_RECOVERY_ATTENTION_DAYS` in `@timeline/shared/job-recovery`. */
export const JOBS_ATTENTION_DAYS = 7;

export const JOB_RECOVERY_PAGE_TITLE = 'Job recovery';

/** Visible row window over the current snapshot. Replace with the shared list virtualizer when it lands. */
export const JOB_RECOVERY_LIST_WINDOW_SIZE = 50;

/** Client continues matching dismiss while the server reports leftovers. */
export const DISMISS_MATCHING_CLIENT_MAX_ROUNDS = 40;

export function jobsPageSubtitle(): string {
  return `Admins can retry or dismiss failed processing from the last ${String(JOBS_ATTENTION_DAYS)} days.`;
}
