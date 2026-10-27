import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { expect } from '@timeline/test-support';
import { afterEach, beforeEach, describe, it } from 'bun:test';

import { CaptureDialog } from '@/components/home/capture-dialog';
// Test environment: happy-dom

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
