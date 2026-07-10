import { createSingleFailedJobRecoveryRoute } from '@/app/api/team/job-recovery/single-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = createSingleFailedJobRecoveryRoute({
  action: 'job.retry',
  operation: 'retry_recoverable_job',
  fallbackCode: 'retry_failed',
  run: (scope, id) => scope.jobRecovery.retryRecoverableJob(id),
});
