import { expect, vi } from '@timeline/test-support';
import { describe, it } from 'bun:test';

const handle = vi.fn();
await vi.mock(
  import.meta.resolve('#src/email/dispatcher.js'),
  () => ({ handleInbound: handle }),
  () => import('#src/email/dispatcher.js'),
);
const { processEmailInboundJob } = await import('#src/email/processor.js');
const { inboundEmailSchema } = await import('#src/email/inbound-schema.js');
const email = inboundEmailSchema.parse({ providerId: 'test-id', text: 'Hello' });
describe('email inbound processor', () => {
  it('passes normalized content to the dispatcher and retries partial team failures', async () => {
    handle.mockResolvedValueOnce({ ok: false, inserted: 1, reason: 'team_ingest_failed' });
    await expect(
      processEmailInboundJob(
        {
          dispatcher: { db: {} as never },
          retrieve: () => Promise.resolve(email),
          admit: () => Promise.resolve(true),
        },
        { emailId: 'test-id' },
      ),
    ).rejects.toThrow('email_ingest_incomplete');
    expect(handle).toHaveBeenCalledWith({ db: {} }, email);
  });
  it('treats sender-limit and routing drops as terminal', async () => {
    handle.mockReset();
    await processEmailInboundJob(
      {
        dispatcher: { db: {} as never },
        retrieve: () => Promise.resolve(email),
        admit: () => Promise.resolve(false),
      },
      { emailId: 'test-id' },
    );
    expect(handle).not.toHaveBeenCalled();
    handle.mockResolvedValueOnce({ ok: false, inserted: 0, reason: 'blocked_sender' });
    await processEmailInboundJob(
      {
        dispatcher: { db: {} as never },
        retrieve: () => Promise.resolve(email),
        admit: () => Promise.resolve(true),
      },
      { emailId: 'test-id' },
    );
    expect(handle).toHaveBeenCalledTimes(1);
  });
});
