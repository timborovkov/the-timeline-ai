import { createBulkFailedJobRecoveryRoute } from '@/app/api/team/job-recovery/bulk-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = createBulkFailedJobRecoveryRoute({
  fallbackError: 'dismiss_failed',
  run: (scope, input) =>
    scope.jobRecovery.dismissFailedRecoverableJobs({
      ...input,
      reason: 'bulk dismiss failed jobs',
    }),
});
