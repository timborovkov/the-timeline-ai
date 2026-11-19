import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';
// Test environment: happy-dom

const fakes = vi.hoisted(() => ({
  selectStarterPathAction: vi.fn(() => new Promise<{ ok: boolean }>(() => undefined)),
  routerRefresh: vi.fn(),
  routerReplace: vi.fn(),
}));

await vi.mock(
  import.meta.resolve('next/navigation'),
  async () => ({
    ...(await import('next/navigation')),
    redirect: vi.fn(),
    useRouter: () => ({
      refresh: fakes.routerRefresh,
      replace: fakes.routerReplace,
    }),
  }),
  () => import('next/navigation'),
);

await vi.mock(
  import.meta.resolve('@/app/actions/first-run'),
  () => ({
    selectStarterPathAction: fakes.selectStarterPathAction,
    submitWorkStyleAction: vi.fn(() => Promise.resolve({ ok: true })),
    skipFirstRunAction: vi.fn(() => Promise.resolve({ ok: true })),
    setFirstRunPhaseAction: vi.fn(() => Promise.resolve({ ok: true })),
    attachOnboardingDocumentAction: vi.fn(() => Promise.resolve({ ok: true })),
  }),
  () => import('@/app/actions/first-run'),
);

await vi.mock(
  import.meta.resolve('@/app/actions/documents'),
  () => ({
    requestDocumentUploadAction: vi.fn(() => Promise.resolve({ ok: false })),
    finalizeDocumentVersionAction: vi.fn(() => Promise.resolve({ ok: false })),
  }),
  () => import('@/app/actions/documents'),
);

await vi.mock(
  import.meta.resolve('@/components/theme-toggle'),
  () => ({
    ThemeToggle: () => <button type="button">Theme</button>,
  }),
  () => import('@/components/theme-toggle'),
);

const { act, cleanup, render, screen } = await import('@testing-library/react');
const { SetupFlow } = await import('./setup-flow.js');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SetupFlow connector auto-start', () => {
  it('disables chooser actions while marketing-intent auto-start is saving', async () => {
    await act(async () => {
      render(
        <SetupFlow
          initialStatus={{
            firstRun: {
              teamId: '11111111-1111-4111-8111-111111111111',
              startedByUserId: '22222222-2222-4222-8222-222222222222',
              phase: 'choose',
              starterPath: null,
              workStyle: null,
              websiteUrl: null,
              websiteHost: null,
              websiteSubject: 'own_team',
              websiteScanId: null,
              scanFailureReason: null,
              captureDocumentId: null,
              captureEventId: null,
              firstCaptureLandedAt: null,
              guideHiddenAt: null,
              starterSelectedAt: null,
              createdAt: new Date('2026-01-01T00:00:00.000Z'),
              updatedAt: new Date('2026-01-01T00:00:00.000Z'),
            },
            inboundEmail: 'northwind@inbound.test',
            teamName: 'Northwind',
            teamId: '11111111-1111-4111-8111-111111111111',
            record: null,
          }}
          preferredSource="slack"
          connectors={['slack', 'telegram']}
        />,
      );
    });

    expect(screen.getByRole('heading', { name: 'Start with one source' })).toBeTruthy();
    const fieldset = screen.getByRole('group');
    expect(fieldset.hasAttribute('disabled')).toBe(true);
    expect(fieldset.getAttribute('aria-busy')).toBe('true');
    expect(fieldset.contains(screen.getByRole('button', { name: 'Skip to Home' }))).toBe(true);
    expect(fieldset.contains(screen.getByRole('button', { name: 'Email', exact: true }))).toBe(
      true,
    );
    expect(fakes.selectStarterPathAction).toHaveBeenCalledWith({ path: 'slack' });
  });
});
