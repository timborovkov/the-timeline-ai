// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CaptureDialog } from '@/components/home/capture-dialog';

describe('CaptureDialog', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/app#capture');
  });

  afterEach(() => {
    cleanup();
    window.history.replaceState(null, '', '/app');
  });

  it('opens when a Capture link lands on the Home hash', async () => {
    render(<CaptureDialog>Capture form</CaptureDialog>);
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeTruthy();
    });
    expect(screen.getByText('Capture form')).toBeTruthy();
  });
});
