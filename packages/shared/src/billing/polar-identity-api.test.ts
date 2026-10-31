import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import { createPolarIdentityApi } from '#src/billing/polar-identity-api.js';
const customer = {
  id: 'customer-a',
  external_id: 'team-a',
  organization_id: 'org-a',
  type: 'team',
};
const person = { userId: 'user-a', email: 'owner@example.test' };
const json = (value: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(value), { status }));
describe('Polar identity API', () => {
  it('rejects wrong customer, team, organization, and unknown customer type', async () => {
    for (const patch of [
      { id: 'other' },
      { external_id: 'other' },
      { organization_id: 'other' },
      { type: 'unknown' },
    ]) {
      const api = createPolarIdentityApi(() => json({ ...customer, ...patch }), 'sandbox', 'org-a');
      await expect(api.customer('team-a', 'customer-a')).rejects.toMatchObject({
        code: 'identity_conflict',
      });
    }
  });
  it('creates a team with a scoped owner and no customer email', async () => {
    const api = createPolarIdentityApi(
      async (path, init) => {
        expect(path).toBe('/customers/');
        expect(
          JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, unknown>,
        ).toEqual({
          type: 'team',
          external_id: 'team-a',
          organization_id: 'org-a',
          name: 'Team',
          owner: { email: person.email, external_id: person.userId },
        });
        return json(customer);
      },
      'sandbox',
      'org-a',
    );
    expect((await api.create('team-a', 'Team', person)).id).toBe('customer-a');
  });
  it('handles organization tokens only after verifying the configured organization', async () => {
    const calls: string[] = [];
    const api = createPolarIdentityApi(
      async (path, init) => {
        calls.push(path);
        if (calls.length === 1)
          return json(
            { detail: [{ type: 'organization_token', loc: ['body', 'organization_id'] }] },
            422,
          );
        if (calls.length === 2) return json({ id: 'org-a' });
        expect(
          (JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, unknown>)
            .organization_id,
        ).toBeUndefined();
        return json(customer);
      },
      'sandbox',
      'org-a',
    );
    expect(await api.create('team-a', 'Team', person)).toEqual(customer);
    expect(calls).toEqual(['/customers/', '/organizations/org-a', '/customers/']);
  });
  it('rereads only the exact external ID on a concurrent create conflict', async () => {
    const api = createPolarIdentityApi(
      (path, init) => {
        if (init?.method === 'POST') return json({}, 409);
        expect(path).toBe('/customers/external/team-a');
        return json(customer);
      },
      'sandbox',
      'org-a',
    );
    expect(await api.create('team-a', 'Team', person)).toEqual(customer);
  });
  it('rejects cross-customer and swapped-member responses', async () => {
    for (const patch of [{ customer_id: 'other' }, { id: 'other' }]) {
      const api = createPolarIdentityApi(
        () =>
          json({
            id: 'member-a',
            customer_id: 'customer-a',
            external_id: 'user-a',
            email: person.email,
            role: 'billing_manager',
            ...patch,
          }),
        'sandbox',
        'org-a',
      );
      await expect(
        api.saveMember('customer-a', person, 'billing_manager', 'member-a'),
      ).rejects.toMatchObject({ code: 'identity_conflict' });
    }
  });
  it('checks subscription ownership before mutation', async () => {
    const api = createPolarIdentityApi(() => json({ customer_id: 'other' }), 'sandbox', 'org-a');
    await expect(api.assertSubscription('customer-a', 'subscription-a')).rejects.toMatchObject({
      operation: 'subscription',
      code: 'identity_conflict',
    });
  });
  it('distinguishes configuration, authorization, conflicts and outages without leaking payloads', async () => {
    for (const [status, code] of [
      [401, 'forbidden'],
      [403, 'forbidden'],
      [409, 'identity_conflict'],
      [422, 'configuration'],
      [429, 'unavailable'],
      [503, 'unavailable'],
    ] as const) {
      const api = createPolarIdentityApi(
        () => json({ secret: 'DO-NOT-LOG' }, status),
        'sandbox',
        'org-a',
      );
      try {
        await api.customer('team-a');
        throw new Error('expected failure');
      } catch (error) {
        expect(error).toMatchObject({ code, status });
        expect(String(error)).not.toContain('DO-NOT-LOG');
      }
    }
    const api = createPolarIdentityApi(
      () => Promise.reject(new Error('token-secret')),
      'sandbox',
      'org-a',
    );
    await expect(api.customer('team-a')).rejects.toMatchObject({ code: 'unavailable' });
  });
  it('conversion preserves customer ID and never assigns an external ID', async () => {
    const api = createPolarIdentityApi(
      async (path, init) => {
        expect(path).toBe('/customers/customer-a');
        expect(
          JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, unknown>,
        ).toEqual({ type: 'team' });
        return json(customer);
      },
      'sandbox',
      'org-a',
    );
    expect((await api.convert('team-a', 'customer-a')).id).toBe('customer-a');
  });
  it('reports an ignored email-clear update instead of claiming successful conversion cleanup', async () => {
    const api = createPolarIdentityApi(
      () => json({ ...customer, email: 'owner@example.test' }),
      'sandbox',
      'org-a',
    );
    await expect(api.clearEmail('team-a', 'customer-a')).rejects.toMatchObject({
      code: 'configuration',
      operation: 'customer_email_clear_unsupported',
    });
  });
});
