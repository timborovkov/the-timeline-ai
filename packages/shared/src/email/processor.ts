import { createHash } from 'node:crypto';

import type { InboundEmail } from '#src/email/inbound-schema.js';
import type { EmailInboundJobData } from '#src/queue/queues.js';

import { handleInbound, type DispatcherDeps } from '#src/email/dispatcher.js';
import { isAudioAttachment } from '#src/email/parser.js';
import { retrieveInboundEmail, ResendError } from '#src/email/resend-client.js';
import { getRedisConnection } from '#src/queue/connection.js';
import { RATE_LIMITS } from '#src/rate-limit/buckets.js';

/** Atomic admission and memoization: retries never consume another sender token. */
async function admitSender(email: InboundEmail): Promise<boolean> {
  const redis = getRedisConnection();
  const sender = createHash('sha256').update(email.from.toLowerCase()).digest('hex');
  const limits = RATE_LIMITS.emailInbound;
  const result = await redis.eval(
    `
    local saved = redis.call('GET', KEYS[1])
    if saved then return tonumber(saved) end
    local old = redis.call('HMGET', KEYS[2], 'tokens', 'ts')
    local tokens = tonumber(old[1]) or tonumber(ARGV[1])
    local ts = tonumber(old[2]) or tonumber(ARGV[3])
    tokens = math.min(tonumber(ARGV[1]), tokens + math.max(0, tonumber(ARGV[3])-ts)/1000*tonumber(ARGV[2]))
    local allowed = 0
    if tokens >= 1 then tokens = tokens-1; allowed = 1 end
    redis.call('HSET', KEYS[2], 'tokens', tokens, 'ts', ARGV[3])
    redis.call('EXPIRE', KEYS[2], 86400)
    redis.call('SET', KEYS[1], allowed, 'EX', 604800)
    return allowed
  `,
    2,
    `email-admission:${email.providerId}`,
    `email-sender:${sender}`,
    limits.capacity,
    limits.refillPerSec,
    Date.now(),
  );
  return Number(result) === 1;
}

export async function processEmailInboundJob(
  deps: {
    dispatcher: DispatcherDeps;
    retrieve?: (id: string) => Promise<InboundEmail>;
    admit?: (email: InboundEmail) => Promise<boolean>;
  },
  data: EmailInboundJobData,
): Promise<void> {
  const email = await (deps.retrieve ?? retrieveInboundEmail)(data.emailId);
  if (!(await (deps.admit ?? admitSender)(email))) return;
  if (email.attachments.length && !deps.dispatcher.attachments)
    throw new ResendError('attachment_storage_not_configured', false);
  if (
    email.attachments.some(
      (attachment) => !isAudioAttachment(attachment.name, attachment.contentType),
    ) &&
    !deps.dispatcher.documents
  )
    throw new ResendError('document_storage_not_configured', false);
  const result = await handleInbound(deps.dispatcher, email);
  if (result.reason === 'team_ingest_failed') throw new Error('email_ingest_incomplete');
  if (result.reason === 'invalid_payload') throw new ResendError('invalid_email_payload', false);
}
