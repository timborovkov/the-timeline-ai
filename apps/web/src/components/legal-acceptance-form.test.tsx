import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';

import type * as ReactModule from 'react';
// Test environment: happy-dom

const fakes = vi.hoisted(() => ({
  action: vi.fn(),
  useActionState: vi.fn(),
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
