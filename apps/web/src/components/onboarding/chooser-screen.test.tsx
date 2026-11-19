import { expect } from '@timeline/test-support';
import { afterEach, describe, it, mock } from 'bun:test';
// Test environment: happy-dom

const { cleanup, fireEvent, render, screen, waitFor } = await import('@testing-library/react');
const { ChooserScreen } = await import('./chooser-screen.js');

afterEach(() => {
  cleanup();
});

describe('ChooserScreen', () => {
  it('offers website scanning with permission confirmation and own-team default', () => {
    render(
      <ChooserScreen
        inboundEmail="northwind-studio@inbound.test"
        onWebsite={() => Promise.resolve()}
        onDocument={() => Promise.resolve()}
        onEmail={() => Promise.resolve()}
        onSkip={() => Promise.resolve()}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Start with one source' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Website' }));
    expect(screen.getByRole('heading', { name: 'Scan your website' })).toBeTruthy();
    expect(screen.queryByText('Coming soon')).toBeNull();
    expect(screen.getByLabelText<HTMLInputElement>('Our team or company').checked).toBe(true);
    expect(screen.getByRole('button', { name: 'Scan' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Document' }));
    expect(screen.getByRole('heading', { name: 'Upload a document' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Email' }));
    expect(screen.getByRole('heading', { name: 'Forward an email' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Skip to Home' })).toBeTruthy();
    expect(screen.getByDisplayValue('northwind-studio@inbound.test')).toBeTruthy();
    expect(screen.queryByText(/sample workspace/i)).toBeNull();
  });

  it('orders Slack and Telegram ahead of base sources and leads with preferred intent', () => {
    render(
      <ChooserScreen
        inboundEmail={null}
        connectors={['slack', 'telegram']}
        preferredSource="telegram"
        onWebsite={() => Promise.resolve()}
        onDocument={() => Promise.resolve()}
        onEmail={() => Promise.resolve()}
        onSlack={() => Promise.resolve()}
        onTelegram={() => Promise.resolve()}
        onSkip={() => Promise.resolve()}
      />,
    );

    const tabs = screen.getByLabelText('Choose a source');
    const labels = [...tabs.querySelectorAll('button')].map((button) => button.textContent);
    expect(labels).toEqual(['Telegram', 'Slack', 'Document', 'Email', 'Website']);
    expect(screen.getByRole('button', { name: 'Telegram' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('starts Slack from the Continue with Slack action', async () => {
    const onSlack = mock(() => Promise.resolve());
    render(
      <ChooserScreen
        inboundEmail={null}
        connectors={['slack']}
        onWebsite={() => Promise.resolve()}
        onDocument={() => Promise.resolve()}
        onEmail={() => Promise.resolve()}
        onSlack={onSlack}
        onSkip={() => Promise.resolve()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Slack' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Slack' }));
    await waitFor(() => {
      expect(onSlack).toHaveBeenCalledTimes(1);
    });
  });

  it('keeps skip and other starters disabled while a document upload is in flight', async () => {
    let release: (() => void) | undefined;
    const onDocument = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });
    render(
      <ChooserScreen
        inboundEmail="northwind-studio@inbound.test"
        onWebsite={() => Promise.resolve()}
        onDocument={onDocument}
        onEmail={() => Promise.resolve()}
        onSkip={() => Promise.resolve()}
      />,
    );
    const file = new File(['deck'], 'deck.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText('Upload a document'), { target: { files: [file] } });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Skip to Home' }).hasAttribute('disabled')).toBe(
        true,
      );
    });
    expect(screen.getByRole('button', { name: 'Email' }).hasAttribute('disabled')).toBe(true);
    release?.();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Skip to Home' }).hasAttribute('disabled')).toBe(
        false,
      );
    });
  });
});
