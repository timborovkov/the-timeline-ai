import { z } from 'zod';

import { childLogger } from '#src/logger.js';
const log = childLogger('billing:identity');

export type PolarIdentityErrorCode =
  'identity_conflict' | 'configuration' | 'forbidden' | 'unavailable';
export class PolarIdentityError extends Error {
  constructor(
    public readonly code: PolarIdentityErrorCode,
    public readonly operation: string,
    public readonly status?: number,
  ) {
    super(
      {
        identity_conflict:
          'This team’s billing identity needs operator review. Contact support before retrying.',
        configuration: 'Team billing is not configured correctly. Contact support.',
        forbidden: 'Polar denied access to this team’s billing. Contact support.',
        unavailable: 'Polar billing is temporarily unavailable. Please retry.',
      }[code],
    );
    this.name = 'PolarIdentityError';
  }
}
const customerSchema = z.object({
  id: z.string().min(1),
  external_id: z.string().nullable(),
  organization_id: z.string().min(1),
  type: z.enum(['individual', 'team']),
  email: z.string().nullable().optional(),
});
const memberSchema = z.object({
  id: z.string().min(1),
  customer_id: z.string().min(1),
  external_id: z.string().nullable(),
  email: z.string(),
  role: z.enum(['owner', 'billing_manager', 'member']),
});
export type PolarCustomerIdentity = z.infer<typeof customerSchema>;
export type PolarMemberIdentity = z.infer<typeof memberSchema>;
export interface PolarPerson {
  userId: string;
  email: string;
  name?: string | null;
}
export interface PolarIdentityApi {
  server: 'sandbox' | 'production';
  organizationId: string;
  customer(teamId: string, customerId?: string | null): Promise<PolarCustomerIdentity | null>;
  create(teamId: string, name: string, owner: PolarPerson): Promise<PolarCustomerIdentity>;
  convert(teamId: string, customerId: string): Promise<PolarCustomerIdentity>;
  clearEmail(teamId: string, customerId: string): Promise<void>;
  members(customerId: string): Promise<PolarMemberIdentity[]>;
  saveMember(
    customerId: string,
    person: PolarPerson,
    role: 'owner' | 'billing_manager',
    memberId?: string,
  ): Promise<PolarMemberIdentity>;
  removeMember(customerId: string, memberId: string): Promise<void>;
  assertSubscription(customerId: string, subscriptionId: string): Promise<void>;
}
export function createPolarIdentityApi(
  fetcher: (path: string, init?: RequestInit) => Promise<Response>,
  server: 'sandbox' | 'production',
  organizationId: string | undefined,
): PolarIdentityApi {
  async function request(
    path: string,
    method = 'GET',
    body?: unknown,
    missing = false,
  ): Promise<unknown> {
    if (!organizationId) throw new PolarIdentityError('configuration', 'organization');
    let response: Response;
    try {
      response = await fetcher(path, {
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new PolarIdentityError('unavailable', method);
    }
    if (missing && response.status === 404) return null;
    if (!response.ok) {
      if (response.status === 422) {
        const parsed = z
          .object({ detail: z.array(z.object({ type: z.string(), loc: z.array(z.string()) })) })
          .safeParse(
            await response
              .clone()
              .json()
              .catch(() => null),
          );
        if (
          parsed.success &&
          parsed.data.detail.some(
            (item) =>
              item.type === 'organization_token' && item.loc.join('.') === 'body.organization_id',
          )
        )
          throw new PolarIdentityError('configuration', 'organization_token', 422);
      }
      log.warn(
        { operation: method, server, status: response.status },
        'Polar identity operation failed',
      );
      throw new PolarIdentityError(
        response.status === 401 || response.status === 403
          ? 'forbidden'
          : response.status === 409
            ? 'identity_conflict'
            : response.status === 422
              ? 'configuration'
              : 'unavailable',
        method,
        response.status,
      );
    }
    if (response.status === 204) return null;
    try {
      return await response.json();
    } catch {
      throw new PolarIdentityError('unavailable', 'response');
    }
  }
  function customer(value: unknown, teamId: string, id?: string | null) {
    const result = customerSchema.safeParse(value);
    if (
      !result.success ||
      result.data.external_id !== teamId ||
      result.data.organization_id !== organizationId ||
      (id && result.data.id !== id)
    )
      throw new PolarIdentityError('identity_conflict', 'customer');
    return result.data;
  }
  function member(value: unknown, customerId: string) {
    const result = memberSchema.safeParse(value);
    if (!result.success || result.data.customer_id !== customerId)
      throw new PolarIdentityError('identity_conflict', 'member');
    return result.data;
  }
  const api: PolarIdentityApi = {
    server,
    organizationId: organizationId ?? '',
    async customer(teamId, id) {
      const data = await request(
        id
          ? `/customers/${encodeURIComponent(id)}`
          : `/customers/external/${encodeURIComponent(teamId)}`,
        'GET',
        undefined,
        true,
      );
      return data === null ? null : customer(data, teamId, id);
    },
    async create(teamId, name, owner) {
      const body = {
        type: 'team',
        external_id: teamId,
        name,
        owner: { email: owner.email, name: owner.name, external_id: owner.userId },
      };
      try {
        return customer(
          await request('/customers/', 'POST', {
            type: 'team',
            external_id: teamId,
            organization_id: organizationId,
            name,
            owner: { email: owner.email, name: owner.name, external_id: owner.userId },
          }),
          teamId,
        );
      } catch (error) {
        if (error instanceof PolarIdentityError && error.operation === 'organization_token') {
          const organization = z
            .object({ id: z.string() })
            .safeParse(await request(`/organizations/${encodeURIComponent(organizationId ?? '')}`));
          if (!organization.success || organization.data.id !== organizationId)
            throw new PolarIdentityError('identity_conflict', 'organization');
          try {
            return customer(await request('/customers/', 'POST', body), teamId);
          } catch (retryError) {
            if (
              !(retryError instanceof PolarIdentityError) ||
              ![409, 422].includes(retryError.status ?? 0)
            )
              throw retryError;
            const existing = await api.customer(teamId);
            if (existing?.type === 'team') return existing;
            throw retryError;
          }
        }
        if (error instanceof PolarIdentityError && (error.status === 409 || error.status === 422)) {
          const existing = await api.customer(teamId);
          if (existing?.type === 'team') return existing;
        }
        throw error;
      }
    },
    async convert(teamId, id) {
      return customer(
        await request(`/customers/${encodeURIComponent(id)}`, 'PATCH', { type: 'team' }),
        teamId,
        id,
      );
    },
    async clearEmail(teamId, id) {
      const updated = customer(
        await request(`/customers/${encodeURIComponent(id)}`, 'PATCH', { email: null }),
        teamId,
        id,
      );
      if (updated.email !== null)
        throw new PolarIdentityError('configuration', 'customer_email_clear_unsupported');
    },
    async members(id) {
      const rows: PolarMemberIdentity[] = [];
      for (let page = 1; ; page++) {
        const data = z
          .object({ items: z.array(z.unknown()), pagination: z.object({ max_page: z.number() }) })
          .safeParse(
            await request(`/customers/${encodeURIComponent(id)}/members?limit=100&page=${page}`),
          );
        if (!data.success) throw new PolarIdentityError('unavailable', 'member_list');
        rows.push(...data.data.items.map((row) => member(row, id)));
        if (page >= data.data.pagination.max_page) return rows;
      }
    },
    async saveMember(id, person, role, memberId) {
      let row: PolarMemberIdentity;
      if (!memberId) {
        row = member(
          await request(`/customers/${encodeURIComponent(id)}/members`, 'POST', {
            email: person.email,
            name: person.name,
            external_id: person.userId,
            role: 'billing_manager',
          }),
          id,
        );
        if (row.external_id !== person.userId)
          throw new PolarIdentityError('identity_conflict', 'member');
        memberId = row.id;
      }
      row = member(
        await request(
          `/customers/${encodeURIComponent(id)}/members/${encodeURIComponent(memberId)}`,
          'PATCH',
          { email: person.email, name: person.name, role },
        ),
        id,
      );
      if (row.id !== memberId || row.role !== role)
        throw new PolarIdentityError('identity_conflict', 'member');
      return row;
    },
    async removeMember(id, memberId) {
      await request(
        `/customers/${encodeURIComponent(id)}/members/${encodeURIComponent(memberId)}`,
        'DELETE',
        undefined,
        true,
      );
    },
    async assertSubscription(customerId, subscriptionId) {
      const data = z
        .object({ customer_id: z.string() })
        .safeParse(await request(`/subscriptions/${encodeURIComponent(subscriptionId)}`));
      if (!data.success || data.data.customer_id !== customerId)
        throw new PolarIdentityError('identity_conflict', 'subscription');
    },
  };
  return api;
}
