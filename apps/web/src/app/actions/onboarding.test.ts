import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveActiveTeam: vi.fn(),
  dismissChecklist: vi.fn(),
  reopenChecklist: vi.fn(),
  markStepComplete: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn((href: string) => {
    throw new Error(`redirect:${href}`);
  }),
}));

vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));
vi.mock('@/lib/active-team', () => ({ resolveActiveTeam: fakes.resolveActiveTeam }));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('next/cache', () => ({ revalidatePath: fakes.revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: fakes.redirect }));
vi.mock('@timeline/shared/team-scope', () => ({
  withTeam: () => ({
    onboarding: {
      dismissChecklist: fakes.dismissChecklist,
      reopenChecklist: fakes.reopenChecklist,
      markStepComplete: fakes.markStepComplete,
    },
  }),
}));

const {
  dismissOnboardingChecklistAction,
  openOnboardingStepAction,
  reopenOnboardingChecklistAction,
} = await import('./onboarding.js');

const USER_ID = '22222222-2222-4222-8222-222222222222';
const TEAM_ID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
  fakes.auth.mockResolvedValue({ user: { id: USER_ID } });
  fakes.resolveActiveTeam.mockResolvedValue({ active: { teamId: TEAM_ID } });
});

describe('onboarding actions', () => {
  it('no-ops dismiss when auth or active team is missing', async () => {
    fakes.auth.mockResolvedValueOnce(null);

    await dismissOnboardingChecklistAction();

    expect(fakes.dismissChecklist).not.toHaveBeenCalled();
    expect(fakes.revalidatePath).not.toHaveBeenCalled();
  });

  it('dismisses and revalidates the app shell', async () => {
    await dismissOnboardingChecklistAction();

    expect(fakes.dismissChecklist).toHaveBeenCalled();
    expect(fakes.revalidatePath).toHaveBeenCalledWith('/app');
  });

  it('reopens or redirects to sign-in when no onboarding scope is available', async () => {
    await expect(reopenOnboardingChecklistAction()).rejects.toThrow('redirect:/app');
    expect(fakes.reopenChecklist).toHaveBeenCalled();
    expect(fakes.revalidatePath).toHaveBeenCalledWith('/app');

    fakes.auth.mockResolvedValueOnce(null);
    await expect(reopenOnboardingChecklistAction()).rejects.toThrow('redirect:/sign-in');
  });

  it('marks valid steps complete and redirects only to safe app paths', async () => {
    const form = new FormData();
    form.set('step', 'first_document');
    form.set('href', '/app/documents');

    await expect(openOnboardingStepAction(form)).rejects.toThrow('redirect:/app/documents');

    expect(fakes.markStepComplete).toHaveBeenCalledWith('first_document');
    expect(fakes.revalidatePath).toHaveBeenCalledWith('/app');

    const unsafe = new FormData();
    unsafe.set('step', 'slack');
    unsafe.set('href', 'https://evil.example.test');
    await expect(openOnboardingStepAction(unsafe)).rejects.toThrow('redirect:/app');
  });
});
