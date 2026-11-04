import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import {
  handlePolarWebhookEvent,
  isIgnorablePolarWebhookFailure,
  type PolarWebhookPayload,
} from '#src/billing/polar-webhook.js';

import type { Db } from '@timeline/db';

// This regression must reject before *any* query, not merely catch a database error.
const db = new Proxy(
  {},
  {
    get() {
      throw new Error('unexpected database access');
    },
  },
) as Db;
describe('Polar webhook external identity boundary', () => {
  it('acknowledges non-UUID sandbox/external IDs without touching the database', async () => {
    for (const externalId of [
      'timeline-identity-test-c122cebd-a917-4929-9a76-66fab9d28be6-0',
      '',
      'not-a-team',
      'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee trailing',
      42,
      {},
    ]) {
      const payload = {
        type: 'subscription.active',
        data: { customer: { external_id: externalId } },
      } as unknown as PolarWebhookPayload;
      await expect(
        handlePolarWebhookEvent({ db, payload, chargesEnabled: true, products: {} }),
      ).resolves.toEqual({ ok: true, ignored: 'invalid_external_customer' });
    }
  });
  it('acknowledges missing team mappings without touching the database', async () => {
    await expect(
      handlePolarWebhookEvent({
        db,
        payload: { type: 'subscription.active', data: { id: 'sub_1' } },
        chargesEnabled: true,
        products: {},
        provider: { identity: {} } as never,
      }),
    ).resolves.toEqual({ ok: true, ignored: 'missing_external_customer' });
  });

  it('treats Postgres UUID syntax errors as ignorable Polar webhook failures', () => {
    expect(
      isIgnorablePolarWebhookFailure(
        new Error(
          'invalid input syntax for type uuid: "timeline-identity-test-c122cebd-a917-4929-9a76-66fab9d28be6-0"',
        ),
      ),
    ).toBe(true);
    expect(isIgnorablePolarWebhookFailure(new Error('identity_conflict'))).toBe(false);
  });

  it('ignores unrelated customer/member events before identity or database access', async () => {
    await expect(
      handlePolarWebhookEvent({
        db,
        payload: { type: 'customer.deleted' },
        chargesEnabled: true,
        products: {},
      }),
    ).resolves.toEqual({ ok: true, ignored: 'unsupported_event' });
  });
});
