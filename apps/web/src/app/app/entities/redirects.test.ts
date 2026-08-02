import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

vi.mock('next/navigation', () => ({ redirect: fakes.redirect }));

import EntityProfileRedirect from '@/app/app/entities/[id]/page';
import EntitiesIndexRedirect from '@/app/app/entities/page';

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
