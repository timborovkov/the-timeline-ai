import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { beforeEach, describe, it } from 'bun:test';

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveActiveTeam: vi.fn(),
  setSelectionLinkedObject: vi.fn(),
}));

await vi.mock(
  import.meta.resolve('@/lib/auth'),
  () => ({ auth: fakes.auth }),
  () => import('@/lib/auth'),
);
await vi.mock(
  import.meta.resolve('@/lib/active-team'),
  () => ({ resolveActiveTeam: fakes.resolveActiveTeam }),
  () => import('@/lib/active-team'),
);
await vi.mock(
  import.meta.resolve('@/lib/db'),
  () => ({ db: {} }),
  () => import('@/lib/db'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/team-scope'),
  () => ({
    withTeam: () => ({
      integrations: {
        setSelectionLinkedObject: fakes.setSelectionLinkedObject,
      },
    }),
  }),
  () => import('@timeline/shared/team-scope'),
);

const { PATCH } = await import('./route.js');

const USER_ID = '22222222-2222-4222-8222-222222222222';
const TEAM_ID = '11111111-1111-4111-8111-111111111111';
const INTEGRATION_ID = '33333333-3333-4333-8333-333333333333';
const SELECTION_ID = '44444444-4444-4444-8444-444444444444';
const OBJECT_ID = '55555555-5555-4555-8555-555555555555';

function params() {
  return { params: Promise.resolve({ id: INTEGRATION_ID, selectionId: SELECTION_ID }) };
}

function patchRequest(body: unknown) {
  return new Request('https://timeline.test/api/integrations/manage/x/selections/y', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.auth.mockResolvedValue({ user: { id: USER_ID } });
  fakes.resolveActiveTeam.mockResolvedValue({ active: { teamId: TEAM_ID, role: 'admin' } });
  fakes.setSelectionLinkedObject.mockResolvedValue(undefined);
});

describe('/api/integrations/manage/[id]/selections/[selectionId]', () => {
  it('requires authentication and an active team', async () => {
    fakes.auth.mockResolvedValueOnce(null);
    const unauthenticated = await PATCH(patchRequest({ linkedObjectId: OBJECT_ID }), params());
    expect(unauthenticated.status).toBe(401);

    fakes.resolveActiveTeam.mockResolvedValueOnce({ active: null });
    const noTeam = await PATCH(patchRequest({ linkedObjectId: OBJECT_ID }), params());
    expect(noTeam.status).toBe(400);
    await expect(noTeam.json()).resolves.toEqual({ error: 'no_team' });
  });

  it('rejects a non-uuid linked object id', async () => {
    const response = await PATCH(patchRequest({ linkedObjectId: 'not-a-uuid' }), params());
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'bad_request' });
    expect(fakes.setSelectionLinkedObject).not.toHaveBeenCalled();
  });

  it('links a Drive selection to a Timeline object', async () => {
    const response = await PATCH(patchRequest({ linkedObjectId: OBJECT_ID }), params());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(fakes.setSelectionLinkedObject).toHaveBeenCalledWith(
      INTEGRATION_ID,
      SELECTION_ID,
      OBJECT_ID,
    );
  });

  it('clears a Drive object link', async () => {
    const response = await PATCH(patchRequest({ linkedObjectId: null }), params());
    expect(response.status).toBe(200);
    expect(fakes.setSelectionLinkedObject).toHaveBeenCalledWith(INTEGRATION_ID, SELECTION_ID, null);
  });

  it('maps missing selection and object errors', async () => {
    fakes.setSelectionLinkedObject.mockRejectedValueOnce(new Error('Selection not found'));
    const missingSelection = await PATCH(patchRequest({ linkedObjectId: OBJECT_ID }), params());
    expect(missingSelection.status).toBe(404);
    await expect(missingSelection.json()).resolves.toEqual({ error: 'not_found' });

    fakes.setSelectionLinkedObject.mockRejectedValueOnce(new Error('Object not found'));
    const missingObject = await PATCH(patchRequest({ linkedObjectId: OBJECT_ID }), params());
    expect(missingObject.status).toBe(400);
    await expect(missingObject.json()).resolves.toEqual({ error: 'object_not_found' });
  });
});
