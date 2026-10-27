import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { beforeEach, describe, it } from 'bun:test';
const fakes = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

await vi.mock(
  import.meta.resolve('next/navigation'),
  async () => ({
    ...(await import('next/navigation')),
    redirect: fakes.redirect,
  }),
  () => import('next/navigation'),
);

const { default: EntityProfileRedirect } = await import('@/app/app/entities/[id]/page');
const { default: EntitiesIndexRedirect } = await import('@/app/app/entities/page');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('legacy entity redirects', () => {
  it('keeps the entity index pointed at the Objects workspace', () => {
    expect(() => {
      EntitiesIndexRedirect();
    }).toThrow('redirect:/app/objects');
    expect(fakes.redirect).toHaveBeenCalledWith('/app/objects');
  });

  it('keeps object IDs intact when redirecting legacy entity detail URLs', async () => {
    await expect(
      EntityProfileRedirect({ params: Promise.resolve({ id: 'object-123' }) }),
    ).rejects.toThrow('redirect:/app/objects/object-123');
    expect(fakes.redirect).toHaveBeenCalledWith('/app/objects/object-123');
  });
});
