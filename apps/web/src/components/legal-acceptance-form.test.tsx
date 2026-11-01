import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';

import type * as ReactModule from 'react';
// Test environment: happy-dom

const fakes = vi.hoisted(() => ({
  action: vi.fn(),
  useActionState: vi.fn(),
  replace: vi.fn(),
}));

await vi.mock(
  import.meta.resolve('react'),
  async (importOriginal) => {
    const actual = await importOriginal<typeof ReactModule>();
    return { ...actual, useActionState: fakes.useActionState };
  },
  () => import('react'),
);
await vi.mock(
  import.meta.resolve('@/app/actions/legal'),
  () => ({ acceptLegalAction: vi.fn() }),
  () => import('@/app/actions/legal'),
);

const { cleanup, render } = await import('@testing-library/react');
const { LegalAcceptanceForm } = await import('@/components/legal-acceptance-form');
const { PRIVACY_VERSION, TERMS_VERSION } = await import('@/lib/legal-versions');

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('location', { pathname: '/legal/accept', replace: fakes.replace });
  fakes.useActionState.mockReturnValue([{}, fakes.action]);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('LegalAcceptanceForm', () => {
  it('moves a gate rendered under the dashboard to its canonical submission URL', () => {
    vi.stubGlobal('location', { pathname: '/app', replace: fakes.replace });
    render(<LegalAcceptanceForm returnTo="/app/team?section=email" />);
    expect(fakes.replace).toHaveBeenCalledWith(
      '/legal/accept?returnTo=%2Fapp%2Fteam%3Fsection%3Demail',
    );
  });

  it('does not reload an acceptance form already on its canonical route', () => {
    render(<LegalAcceptanceForm returnTo="/app" />);
    expect(fakes.replace).not.toHaveBeenCalled();
  });

  it('submits the exact legal versions displayed to the user', () => {
    render(<LegalAcceptanceForm returnTo="/app" />);

    expect(document.querySelector<HTMLInputElement>('input[name="termsVersion"]')?.value).toBe(
      TERMS_VERSION,
    );
    expect(document.querySelector<HTMLInputElement>('input[name="privacyVersion"]')?.value).toBe(
      PRIVACY_VERSION,
    );
  });
});
