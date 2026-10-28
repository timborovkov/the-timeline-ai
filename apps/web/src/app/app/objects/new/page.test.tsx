import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { beforeEach, describe, it } from 'bun:test';
const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveActiveTeam: vi.fn(),
  listObjects: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

await vi.mock(
  import.meta.resolve('next/navigation'),
  async () => ({
    ...(await import('next/navigation')),
    redirect: fakes.redirect,
    useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
  }),
  () => import('next/navigation'),
);
await vi.mock(
  import.meta.resolve('@timeline/shared/team-scope'),
  () => ({
    withTeam: () => ({ objects: { listObjects: fakes.listObjects } }),
  }),
  () => import('@timeline/shared/team-scope'),
);
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
  import.meta.resolve('@/components/objects/new-object-form'),
  () => ({
    NewObjectForm: ({
      projects,
      defaultProjectId,
    }: {
      projects: { id: string; label: string }[];
      defaultProjectId: string;
    }) => (
      <div data-testid="new-object-form">
        {defaultProjectId}|{projects.map((project) => project.label).join(',')}
      </div>
    ),
  }),
  () => import('@/components/objects/new-object-form'),
);

const { renderToStaticMarkup } = await import('react-dom/server');

const { default: NewObjectPage } = await import('./page.js');

beforeEach(() => {
  vi.clearAllMocks();
  fakes.auth.mockResolvedValue({ user: { id: 'user-1' } });
  fakes.resolveActiveTeam.mockResolvedValue({ active: { teamId: 'team-1' } });
  fakes.listObjects.mockResolvedValue([]);
});

describe('NewObjectPage', () => {
  it('keeps the Objects work navigation available', async () => {
    const html = renderToStaticMarkup(await NewObjectPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain('aria-label="Work"');
    expect(html).toMatch(/aria-current="page"[^>]*href="\/app\/objects"/);
  });

  it('hydrates the requested project outside the preload window', async () => {
    const projectId = '00000000-0000-4000-8000-000000000099';
    fakes.listObjects.mockImplementation((filter: { id?: string[] }) =>
      Promise.resolve(
        filter.id?.includes(projectId)
          ? [{ id: projectId, canonicalName: 'Older client project' }]
          : [],
      ),
    );

    const html = renderToStaticMarkup(
      await NewObjectPage({ searchParams: Promise.resolve({ project: projectId }) }),
    );

    expect(fakes.listObjects).toHaveBeenCalledWith({
      id: [projectId],
      type: 'project',
      archived: false,
      limit: 1,
    });
    expect(html).toContain(`${projectId}|Older client project`);
  });
});
