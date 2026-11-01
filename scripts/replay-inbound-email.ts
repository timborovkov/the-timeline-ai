import {
  closeEmailInboundQueue,
  closeRedisConnection,
  enqueueEmailInboundJob,
  getEmailInboundQueue,
} from '@timeline/shared/queue';

const emailId = process.argv[2];
if (
  !emailId ||
  !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(emailId)
)
  throw new Error('Usage: bun run email:replay -- <received-email-uuid>');
try {
  const existing = await getEmailInboundQueue().getJob(`resend-${emailId}`);
  if (existing) {
    const state = await existing.getState();
    if (state === 'failed' || state === 'completed')
      await existing.retry(state, { resetAttemptsMade: true, resetAttemptsStarted: true });
    else console.log(`Email replay already ${state}`);
  } else await enqueueEmailInboundJob({ emailId });
  console.log(`Queued Resend email ${emailId}`);
} finally {
  await closeEmailInboundQueue();
  await closeRedisConnection();
}
