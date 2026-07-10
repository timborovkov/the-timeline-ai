import { createSingleFailedJobRecoveryRoute } from '@/app/api/team/job-recovery/single-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = createSingleFailedJobRecoveryRoute({
  action: 'job.dismiss',
  operation: 'dismiss_recoverable_job',
  fallbackCode: 'dismiss_failed',
  run: (scope, id) => scope.jobRecovery.dismissRecoverableJob(id),
});
