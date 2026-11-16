import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';

import { NativeProviderConnectButton } from '@/components/native-provider-connect-button';

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe('NativeProviderConnectButton', () => {
  it('starts non-Drive providers immediately', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ url: 'https://github.com/login' }))),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<NativeProviderConnectButton providerId="github" label="Connect" />);
    await user.click(screen.getByRole('button', { name: 'Connect: github' }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: 'Connect Google Drive' })).toBeNull();
  });

  it('requires Continue to Google before Drive OAuth starts', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ url: 'https://accounts.google.com/o' }))),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<NativeProviderConnectButton providerId="google_drive" label="Connect" />);
    await user.click(screen.getByRole('button', { name: 'Connect: google_drive' }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Connect Google Drive' })).toBeTruthy();
    expect(screen.getByText(/Cited timeline events already captured stay/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Continue to Google' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/integrations/google_drive/start', {
      method: 'POST',
    });
  });
});
