// @vitest-environment happy-dom

import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ReactModule from 'react';

import { LegalAcceptanceForm } from '@/components/legal-acceptance-form';
import { PRIVACY_VERSION, TERMS_VERSION } from '@/lib/legal-versions';

const fakes = vi.hoisted(() => ({
  action: vi.fn(),
  useActionState: vi.fn(),
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactModule>();
  return { ...actual, useActionState: fakes.useActionState };
});
vi.mock('@/app/actions/legal', () => ({ acceptLegalAction: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  fakes.useActionState.mockReturnValue([{}, fakes.action]);
});

afterEach(cleanup);

describe('LegalAcceptanceForm', () => {
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
