import { expect } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';
// Test environment: happy-dom

const { cleanup, render, screen } = await import('@testing-library/react');
const { ChooserScreen } = await import('./chooser-screen.js');

afterEach(() => {
  cleanup();
});

describe('ChooserScreen', () => {
  it('shows four equal cards and marks website scan coming soon when the flag is off', () => {
    render(
      <ChooserScreen
        inboundEmail="northwind-studio@inbound.test"
        websiteScanEnabled={false}
        onWebsite={() => Promise.resolve()}
        onDocument={() => Promise.resolve()}
        onEmail={() => Promise.resolve()}
        onSkip={() => Promise.resolve()}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Bring something real' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Scan your website' })).toBeTruthy();
    expect(screen.getByText('Coming soon')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Scan' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('heading', { name: 'Upload a document' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Forward an email' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Skip for now' })).toBeTruthy();
    expect(screen.getByDisplayValue('northwind-studio@inbound.test')).toBeTruthy();
    expect(screen.queryByText(/sample workspace/i)).toBeNull();
  });
});
