import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveActiveTeam: vi.fn(),
  listObjects: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

vi.mock('next/navigation', () => ({
  redirect: fakes.redirect,
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}));
vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({ objects: { listObjects: fakes.listObjects } }),
}));
vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.resolveActiveTeam }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/components/objects/new-object-form', () => ({
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
}));

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
