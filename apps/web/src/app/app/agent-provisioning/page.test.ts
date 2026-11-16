import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { beforeEach, describe, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

const mocks = vi.hoisted(() => ({
  getRequestIdentity: vi.fn(),
  listProvisioningGrants: vi.fn(),
  listProvisioningAudit: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`);
  }),
}));

await vi.mock(
  import.meta.resolve('@/lib/auth'),
  () => ({ getRequestIdentity: mocks.getRequestIdentity }),
  () => import('@/lib/auth'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/agent-provisioning'),
  () => ({
    listProvisioningGrants: mocks.listProvisioningGrants,
    listProvisioningAudit: mocks.listProvisioningAudit,
  }),
  () => import('@timeline/shared/agent-provisioning'),
);
await vi.mock(
  import.meta.resolve('next/navigation'),
  () => ({ redirect: mocks.redirect }),
  () => import('next/navigation'),
);
await vi.mock(
  import.meta.resolve('@/lib/db'),
  () => ({ db: { kind: 'test-db' } }),
  () => import('@/lib/db'),
);
await vi.mock(
  import.meta.resolve('@/app/actions/agent-provisioning'),
  () => ({ revokeAgentProvisioningAction: vi.fn() }),
  () => import('@/app/actions/agent-provisioning'),
);
await vi.mock(
  import.meta.resolve('@/components/agent-provisioning-form'),
  () => ({ AgentProvisioningForm: () => null }),
  () => import('@/components/agent-provisioning-form'),
);

const { default: AgentProvisioningPage } = await import('@/app/app/agent-provisioning/page');

describe('Agent provisioning page', () => {
  beforeEach(() => {
    mocks.getRequestIdentity.mockReset();
    mocks.listProvisioningGrants.mockReset();
    mocks.listProvisioningAudit.mockReset();
    mocks.redirect.mockClear();
  });

  it('rejects impersonation before loading account-wide grants', async () => {
    mocks.getRequestIdentity.mockResolvedValue({
      session: { user: { id: 'admin-id' } },
      impersonation: { user: { id: 'member-id' } },
    });

    await expect(AgentProvisioningPage()).rejects.toThrow('Exit impersonation first');
    expect(mocks.listProvisioningGrants).not.toHaveBeenCalled();
    expect(mocks.listProvisioningAudit).not.toHaveBeenCalled();
  });

  it('loads grants for the real signed-in owner', async () => {
    mocks.getRequestIdentity.mockResolvedValue({
      session: { user: { id: 'owner-id' } },
      impersonation: null,
    });
    mocks.listProvisioningGrants.mockResolvedValue([]);
    mocks.listProvisioningAudit.mockResolvedValue([]);

    const html = renderToStaticMarkup(await AgentProvisioningPage());
    expect(html).toContain('No grants yet');
    expect(html).toContain('No activity yet');

    expect(mocks.listProvisioningGrants).toHaveBeenCalledWith({ kind: 'test-db' }, 'owner-id');
    expect(mocks.listProvisioningAudit).toHaveBeenCalledWith({ kind: 'test-db' }, 'owner-id');
  });
  it('shows grant status, readable activity, and only available revoke actions', async () => {
    mocks.getRequestIdentity.mockResolvedValue({
      session: { user: { id: 'owner-id' } },
      impersonation: null,
    });
    mocks.listProvisioningGrants.mockResolvedValue([
      {
        id: 'active',
        name: 'Setup agent',
        prefix: 'tlp_example',
        used: 1,
        allowance: 3,
        allowCapture: true,
        expiresAt: new Date('2099-01-01'),
        revokedAt: null,
      },
      {
        id: 'revoked',
        name: 'Old agent',
        prefix: 'tlp_old',
        used: 0,
        allowance: 1,
        allowCapture: false,
        expiresAt: new Date('2020-01-01'),
        revokedAt: new Date('2019-12-31'),
      },
    ]);
    mocks.listProvisioningAudit.mockResolvedValue([
      { id: 'event', action: 'grant.created', createdAt: new Date('2026-11-11T12:00:00Z') },
    ]);
    const html = renderToStaticMarkup(await AgentProvisioningPage());
    expect(html).toContain('Active');
    expect(html).toContain('Revoked');
    expect(html).toContain('Grant created');
    expect(html).toContain('Revoke Setup agent');
    expect(html).not.toContain('Revoke Old agent');
    expect(html).not.toContain('No grants yet');
    expect(html).not.toContain('No activity yet');
  });
});
